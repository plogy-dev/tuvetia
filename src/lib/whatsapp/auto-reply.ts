// Modo auto de Athos sobre WhatsApp — SOLO servidor, disparado por el webhook vía after().
//
// Diseño (salvaguardas antes que inteligencia, patrón validado en el repo del cliente):
//  1. Opt-in por clínica (whatsapp_integrations.agent_mode = 'auto').
//  2. Debounce 5 s: si el titular sigue escribiendo, este trigger se aborta (responde el último).
//  3. Reserva atómica del entrante (compare-and-set sobre auto_reply_claimed_at): una respuesta
//     por mensaje aunque el webhook reintente. Va antes del modelo, no después.
//  4. Anti-loop: máx. 8 respuestas auto/hora por conversación.
//  5. Límite diario por clínica (auto_daily_limit). Los frenos 4 y 5 se cuentan sobre
//     athos_actions (source='auto') — NO sobre whatsapp_messages, porque cartera también envía
//     con agent_mode='auto' y estaría gastando la cuota del asistente clínico.
//  6. NADA clínico jamás: un solo pase del modelo liviano clasifica y redacta; ante duda, silencio
//     (el mensaje queda sin leer para el vet, como siempre).
// Contexto 100% ensamblado acá con service_role + clinic_id EXPLÍCITO — nunca se le pasan tools
// al modelo en este camino (con service_role, las tools RLS-dependientes verían otras clínicas).

import { generateText, stepCountIs } from "ai"

import { createAdminClient } from "@/lib/supabase/admin"
import { buildAutoReplyTools } from "@/lib/athos-agent/auto-tools"
import { autoModel } from "@/lib/athos-agent/model"
import { registrarUso } from "@/lib/athos-agent/usage"
import { consultarPresupuesto } from "@/lib/athos-agent/presupuesto"
import { clinicaPuede } from "@/lib/planes/servidor"
import { sendWhatsAppText } from "./send-message"
import {
  anotarQueNoSeContesto,
  guardarConversacion,
  leerConversacion,
  mezclarDatos,
} from "./conversacion"
import { bloqueParaElPrompt, faltantes, type DatosDeLaCita } from "./datos-de-la-cita"
import { hayCitaEnCurso, intencionDeLaConversacion } from "./intencion"
import { TURNOS_ANTES_DE_ENTREGAR, respuestaDeRescate } from "./respuestas-de-rescate"
const DEBOUNCE_MS = 5_000
const MAX_PER_HOUR_PER_CONVERSATION = 8

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]

const digits = (s: string) => s.replace(/\D/g, "")

export async function maybeAutoReply(input: {
  clinicId: string
  waMessageId: string
  fromPhone: string
  text: string | null
}): Promise<void> {
  const { clinicId, waMessageId, fromPhone } = input
  if (!input.text?.trim()) return // media/reacciones: siempre al vet
  const admin = createAdminClient()

  // 1) Opt-in de la clínica.
  const { data: integ } = await admin
    .from("whatsapp_integrations")
    .select("agent_mode, auto_daily_limit, status, connected_at, confirma_citas_solo")
    .eq("clinic_id", clinicId)
    .maybeSingle()
  const cfg = integ as {
    agent_mode: string
    auto_daily_limit: number
    status: string
    connected_at: string | null
    /** Nivel 3 de la barra: VetGPT cierra la cita en vez de dejarla para que un vet la apruebe. */
    confirma_citas_solo: boolean | null
  } | null
  if (!cfg || cfg.status !== "connected" || cfg.agent_mode !== "auto") return

  // Warm-up: un número recién conectado no arranca a todo volumen (patrón de baneo clásico).
  // Rampa: 5 respuestas/día el día 0, +5 por día, hasta el límite configurado.
  const daysConnected = cfg.connected_at
    ? Math.floor((Date.now() - new Date(cfg.connected_at).getTime()) / 86_400_000)
    : 0
  const effectiveDailyLimit = Math.min(cfg.auto_daily_limit, 5 * (1 + daysConnected))

  // 2) Debounce: esperar y abortar si llegó un entrante más nuevo de este teléfono.
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS))
  const last10 = digits(fromPhone).slice(-10)
  const { data: newer } = await admin
    .from("whatsapp_messages")
    .select("wa_message_id")
    .eq("clinic_id", clinicId)
    .eq("direction", "inbound")
    .ilike("wa_phone_from", `%${last10}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if ((newer as { wa_message_id: string | null } | null)?.wa_message_id !== waMessageId) return

  // 3) RESERVA ATÓMICA del entrante. Antes acá había una consulta de idempotencia contra
  //    athos_actions, pero esa fila se escribe DESPUÉS de enviar: entre el chequeo y la escritura
  //    pasan varios segundos (debounce + modelo) y un reintento del webhook colaba una segunda
  //    respuesta al titular. El compare-and-set lo cierra: solo una invocación sella la columna;
  //    la otra recibe 0 filas y se calla. Mismo patrón que las acciones de Athos (PR #28).
  //    Va ANTES de los frenos y del modelo: la decisión completa corre a lo sumo una vez.
  const { data: claimed, error: claimError } = await admin
    .from("whatsapp_messages")
    .update({ auto_reply_claimed_at: new Date().toISOString() })
    .eq("clinic_id", clinicId)
    .eq("wa_message_id", waMessageId)
    .is("auto_reply_claimed_at", null)
    .select("id")
  if (claimError) {
    // Distinto de perder la carrera: acá algo está mal (típicamente, la migración 0038 sin aplicar).
    // Sin este log el modo auto se apagaría en silencio y nadie se enteraría.
    console.error("whatsapp/auto-reply: no se pudo reservar el entrante:", claimError.message)
    return
  }
  if (!(claimed ?? []).length) return // otra invocación se lo quedó: correcto, silencio

  // 4) + 5) Frenos. Se cuentan sobre athos_actions (source='auto'), NO sobre whatsapp_messages:
  //    cartera también envía con agent_mode='auto' y estaba consumiendo esta misma cuota, así que
  //    una clínica con cobranza activa podía agotar auto_daily_limit y dejar MUDO al asistente
  //    clínico. athos_actions con source='auto' lo escribe solo este camino (cartera no la toca),
  //    o sea que cada subsistema gasta lo suyo.
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const conversationKey = digits(fromPhone)
  const [{ count: daily }, { count: hourly }] = await Promise.all([
    admin
      .from("athos_actions")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("source", "auto")
      .eq("status", "executed")
      .gte("created_at", dayAgo),
    admin
      .from("athos_actions")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
      .eq("source", "auto")
      .eq("status", "executed")
      .eq("conversation_key", conversationKey)
      .gte("created_at", hourAgo),
  ])
  // LOS TOPES CORTAN EN SILENCIO Y ESO NO CAMBIA: mandar el rescate acá derrotaría la rampa
  // anti-baneo, que es exactamente la razón de ser de estos dos frenos. Lo que sí cambia es que
  // dejan rastro. Hasta hoy los cuatro cortes de este camino hacían `return` seco, y por eso la
  // pregunta «¿por qué VetGPT no le contestó?» sólo se podía responder leyendo código.
  if ((daily ?? 0) >= effectiveDailyLimit) {
    await anotarQueNoSeContesto({ clinicId, conversationKey, motivo: "tope_diario" })
    return
  }
  if ((hourly ?? 0) >= MAX_PER_HOUR_PER_CONVERSATION) {
    await anotarQueNoSeContesto({ clinicId, conversationKey, motivo: "tope_por_chat" })
    return
  }

  // 6) TOPE MENSUAL DE IA DE LA CLÍNICA. Los frenos de arriba son anti-loop y anti-baneo: cuentan
  //    RESPUESTAS ENVIADAS por conversación y por día. Éste cuenta GASTO, y es el único que ve el
  //    cupo compartido con el chat, la bandeja, cartera y la lectura de facturas.
  //
  //    Va acá y no sólo en las rutas HTTP a propósito: el modo automático es, junto con cartera,
  //    la superficie que gasta sin que el vet lo note. Un tope que sólo frenara las pantallas
  //    dejaría el agujero exactamente donde está el gasto que nadie mira.
  //
  //    Sin cupo, silencio — que es el comportamiento normal de este camino cuando decide no
  //    responder: el mensaje queda sin leer para el vet, que lo contesta él.
  // 0. EL PLAN, ANTES QUE EL CUPO. El modo automático es de Pro. Se comprueba acá —y no sólo en la
  //    pantalla donde se enciende el interruptor— porque este camino arranca desde el webhook del
  //    proveedor, sin sesión y sin nadie mirando: una clínica que baje a free con el interruptor
  //    encendido seguiría respondiendo con IA en cada mensaje entrante hasta que alguien lo notara.
  //
  //    Silencio, igual que sin cupo: el mensaje queda sin leer y lo contesta el vet. Es lo correcto
  //    incluso desde el lado del titular — mejor una respuesta humana tarde que ninguna.
  if (!(await clinicaPuede(clinicId, "whatsapp-automatico"))) {
    console.info(
      `[auto-reply] clínica ${clinicId} en plan free: el modo automático no responde y el mensaje queda para el vet.`,
    )
    await anotarQueNoSeContesto({ clinicId, conversationKey, motivo: "plan_free" })
    return
  }

  const presupuesto = await consultarPresupuesto(clinicId)
  if (!presupuesto.permitido) {
    console.warn(
      `[auto-reply] clínica ${clinicId} sin cupo de IA este mes (${presupuesto.usadas}/${presupuesto.tope}): el mensaje queda para el vet.`,
    )
    await anotarQueNoSeContesto({ clinicId, conversationKey, motivo: "sin_cupo_de_ia" })
    return
  }

  // Contexto: clínica + horarios reales + hilo reciente + titular + la conversación que ya venía
  // (clinic_id explícito SIEMPRE). Todo en el mismo viaje: son independientes entre sí.
  const [{ data: clinic }, { data: hours }, { data: thread }, { data: ownerRows }, previa] = await Promise.all([
    admin.from("clinics").select("name").eq("id", clinicId).maybeSingle(),
    admin
      .from("clinic_hours")
      .select("weekday, opens_at, closes_at")
      .eq("clinic_id", clinicId)
      // EL DE LA CLÍNICA, no el de nadie en particular (0069). Al otro lado hay un TITULAR
      // preguntando a qué hora abren: contestarle con el horario personal de un veterinario sería
      // decirle que la clínica abre a las 2 porque ese día ese vet entra a las 2.
      .is("vet_id", null)
      .order("weekday")
      .order("opens_at"),
    admin
      .from("whatsapp_messages")
      .select("direction, body, created_at")
      .eq("clinic_id", clinicId)
      .or(`wa_phone_from.ilike.%${last10},wa_phone_to.ilike.%${last10}`)
      .order("created_at", { ascending: false })
      .limit(12),
    admin.from("owners").select("id, full_name").eq("clinic_id", clinicId).ilike("phone", `%${last10}%`).limit(1),
    // DÓNDE VENÍA ESTA CONVERSACIÓN. Sin esto el agente se reconstruye entero en cada mensaje
    // leyendo el hilo, y no puede responder las dos preguntas que importan: «¿esta persona está
    // agendando?» y «¿qué datos ya me dio?». Es lo que dejó a un titular hablando solo el 30-ago.
    leerConversacion(clinicId, conversationKey),
  ])
  const owner = (ownerRows as { id: string; full_name: string }[] | null)?.[0] ?? null

  // LA INTENCIÓN NO SE PIERDE POR UN MENSAJE QUE NO DICE NADA. «Mañana» no menciona ninguna cita, y
  // un clasificador sin memoria lo leería como una consulta suelta — que es como se perdió el hilo.
  // Lo clínico, en cambio, gana siempre y dura un solo turno (ver `intencion.ts`).
  // `let` porque más abajo la conducta del modelo puede promoverla: haber llamado una herramienta
  // de agenda es mejor evidencia que cualquier palabra del mensaje.
  let intencion = intencionDeLaConversacion(input.text ?? "", previa.intencion)

  // La pizarra del turno: la llena la tool `anotar_datos_de_la_cita` mientras el modelo trabaja, y
  // se persiste UNA sola vez al final. Un `update` por cada dato serían cuatro escrituras por
  // conversación dentro del `after()` de un webhook, para el mismo resultado.
  const pizarra: { datos: DatosDeLaCita; sinHorarios: boolean } = {
    datos: { ...previa.datos },
    sinHorarios: false,
  }
  const hoursText = ((hours as { weekday: number; opens_at: string; closes_at: string }[] | null) ?? [])
    .map((h) => `${WEEKDAYS[h.weekday]}: ${h.opens_at.slice(0, 5)}–${h.closes_at.slice(0, 5)}`)
    .join(" · ")
  const threadText = (((thread as { direction: string; body: string | null }[] | null) ?? []) as {
    direction: string
    body: string | null
  }[])
    .reverse()
    .map((m) => `${m.direction === "inbound" ? "Titular" : "Clínica"}: ${m.body ?? "[adjunto]"}`)
    .join("\n")

  // Una sola resolución: el mismo objeto da el modelo que atiende y, más abajo, el id que se
  // registra. Con `ATHOS_AUTO_CASCADE` puesta, si responde el respaldo `proposed_by_model` guarda
  // ESE — antes se leía de una segunda función que ignoraba la cascada.
  const elegido = autoModel()

  // Tools acotadas por clínica Y por el titular de este número (ver `athos-agent/auto-tools.ts`).
  // Sin titular reconocido el juego se reduce a consultar cupos: un número desconocido no puede
  // enumerar mascotas ni proponer nada.
  const tools = buildAutoReplyTools(admin, {
    clinicId,
    ownerId: owner?.id ?? null,
    conversationKey,
    model: elegido.modelId,
    pizarra,
    // Sólo cuenta con `agent_mode='auto'`, y a esta altura eso ya está comprobado (la salida
    // temprana de más arriba). Ver la migración 0102 para por qué son dos columnas y no un enum.
    confirmaSolo: cfg.confirma_citas_solo === true,
  })

  try {
    const result = await generateText({
      model: elegido.model,
      // Sube de 250 porque ahora hay pasos de tool antes del texto final; el mensaje al titular sigue
      // siendo de 1-3 frases.
      maxOutputTokens: 500,
      tools,
      // Esto corre dentro del `after()` de un webhook: una cadena larga de tools acá es latencia y
      // gasto sin nadie mirando. Eran cuatro pasos, y con la recolección completa —especie, motivo y
      // correo, más la lectura de vuelta antes de confirmar— cuatro es el PISO exacto sin holgura:
      // consultar cupos, reconsultar otro día si el primero estaba cerrado, solicitar_cita y el
      // texto final ya lo llenan. Un turno que se queda sin pasos no deja texto, y el titular se
      // come un silencio — que es justo el defecto del 30-ago.
      //
      // Ocho da margen para dos consultas de agenda sin abrir la puerta a una cadena infinita. El
      // `console.warn` de más abajo ("se llamaron tools y no quedó texto") es el instrumento para
      // saber si ocho también queda corto: si aparece seguido, hay que subirlo.
      stopWhen: stepCountIs(8),
      system: `Eres el asistente de WhatsApp de la clínica veterinaria "${(clinic as { name: string } | null)?.name ?? "la clínica"}" (Colombia, tuteo).

Decide si el ÚLTIMO mensaje del titular es respondible automáticamente y, si lo es, responde.

RESPONDIBLE (responde tú): saludos, horarios de atención, ubicación/cómo agendar, pedir o reprogramar cita, agradecimientos.
NO RESPONDIBLE (guarda silencio): CUALQUIER cosa clínica (síntomas, medicamentos, dosis, urgencias), precios, quejas, pagos, o cualquier duda — ante la mínima duda, silencio.

Si NO es respondible, responde EXACTAMENTE: NO_REPLY
Si es respondible: SOLO el texto del mensaje (1-3 frases, cálido, sin markdown, sin firmar).
Reglas duras: nunca inventes horarios/precios/direcciones. Horarios reales de la clínica: ${hoursText || "NO CONFIGURADOS (no menciones horarios)"}.

CITAS — tienes herramientas, úsalas en vez de prometer de memoria:
- Consulta list_available_slots antes de nombrar CUALQUIER horario. Nunca inventes disponibilidad.
- Para proponer, primero list_my_patients (necesitas el patient_id de la mascota) y después propose_appointment.
- propose_appointment NO agenda: deja la cita pendiente de que el equipo la confirme. Dile al titular que se la confirman en breve — JAMÁS que ya quedó agendada.
- Si las herramientas de mascotas no están disponibles, es que NO reconocemos este número. Ahí usa solicitar_cita,
  juntando los datos en ESTE orden, agrupados, nunca de a uno:
  1) su NOMBRE y el NOMBRE DE LA MASCOTA (un solo mensaje);
  2) la ESPECIE (perro, gato, ave, conejo, roedor, reptil u otro) y el MOTIVO de la consulta (un solo mensaje);
  3) el día y la hora, después de consultar list_available_slots;
  4) el CORREO, diciéndole para qué es (mandarle la confirmación). Si no lo quiere dar, seguí sin él: NO es obligatorio
     y no se lo vuelvas a pedir.
  Nunca preguntes el teléfono: ya lo tenemos, es el número desde el que te escribe.
  Cada vez que la persona te dé un dato, llama anotar_datos_de_la_cita ANTES de contestarle: es lo que hace que no se
  te pierda entre mensajes. Un mensaje puede traer varios datos de una ("Santiago Tellez, mi mascota se llama Milo").
  Lo que la persona ya te dijo NO se vuelve a preguntar. Antes de llamar solicitar_cita, LEELE DE VUELTA todo lo que
  juntaste (nombre, mascota, especie, motivo, día y hora, correo) y pedile que confirme. Sólo con su confirmación la llamás.
- SIN CUPOS NO TE CALLES. Si list_available_slots devuelve configured:false, lee su campo note y haz lo que dice.
  Con motivo "sin_horarios_configurados" la clínica no cargó su agenda: toma el pedido igual, pregunta qué día y franja
  le sirven en palabras, y llama solicitar_cita con sin_hora:true. Con motivo "cerrado_ese_dia", ofrece otro día.
  Quedarte mudo a mitad de un agendamiento no es prudencia: es dejar a un cliente esperando una respuesta que no llega.
- Nunca menciones citas, mascotas ni datos de OTRAS personas. Sólo lo que devuelvan tus herramientas.
${
  hayCitaEnCurso(intencion)
    ? `
ESTA CONVERSACIÓN YA ES UN AGENDAMIENTO. Sigue con él aunque el último mensaje sea corto o confuso ("Mañana", "?",
"sí"): no arranques de cero ni lo trates como una consulta suelta.
${bloqueParaElPrompt(pizarra.datos)}
Si te pregunta algo CLÍNICO en el medio, no se lo contestes: seguí con la cita y decile que el veterinario le responde
eso aparte.`
    : ""
}`,
      messages: [
        {
          role: "user",
          content: `Conversación reciente:\n${threadText}\n\n(El último mensaje del titular es el que debes evaluar.)`,
        },
      ],
    })
    // Se registra ANTES de decidir si se responde: el NO_REPLY también costó tokens, y no contarlo
    // subestimaría el gasto del modo auto justo en el caso más frecuente.
    //
    // `totalUsage` y no `usage`: con tools esto son VARIOS pasos, y `usage` es sólo el último. Antes
    // daban lo mismo porque había un solo paso — al meter tools dejaron de darlo, y `usage` habría
    // facturado la última llamada como si fuera todo el turno. Es lo mismo que usa el chat del vet.
    void registrarUso({
      clinicId,
      userId: null, // modo auto: no hay vet detrás
      surface: "auto_reply",
      elegido,
      usage: result.totalUsage,
    })

    // Lo que quedó en la pizarra después de que el modelo trabajó. `mezclarDatos` no deja que un
    // campo vacío borre uno que ya estaba: cada turno SUMA, nunca reemplaza.
    const datosDelTurno = mezclarDatos(previa.datos, pizarra.datos)
    const sinHorarios = pizarra.sinHorarios

    // ── LA CONDUCTA COMO SEÑAL, QUE ES LA QUE NO SE PUEDE FINGIR ────────────────────────────────
    //
    // Las palabras clasifican mal a propósito de un mensaje corto. Haber LLAMADO una herramienta de
    // agenda, en cambio, es una decisión que el modelo ya tomó: para eso tuvo que entender que
    // había una cita en juego. Promueve la intención aunque el texto no dijera nada.
    const HERRAMIENTAS_DE_AGENDA = new Set([
      "anotar_datos_de_la_cita",
      "list_available_slots",
      "solicitar_cita",
      "propose_appointment",
    ])
    const tocoLaAgenda = result.steps.some((s) =>
      s.toolCalls.some((c) => HERRAMIENTAS_DE_AGENDA.has(c.toolName)),
    )
    // Lo clínico NO se promueve: si el titular contó un síntoma, este turno se calla aunque haya
    // consultado la agenda antes.
    if (tocoLaAgenda && intencion !== "clinico") intencion = "cita"

    // ¿AVANZÓ ALGO? Se cuenta por datos, no por mensajes: tres «?» seguidos no llenan un solo campo,
    // y es justo cuando hay que dejar de insistir y entregarle la conversación a una persona.
    const avanzo = faltantes(previa.datos).length > faltantes(datosDelTurno).length
    const sinAvance = avanzo ? 0 : previa.mensajesSinAvance + 1

    // ── ENVIAR, EN UN SOLO LUGAR ────────────────────────────────────────────────────────────────
    //
    // Esto estaba escrito derecho abajo, y extraerlo NO es prolijidad: desde que existe la respuesta
    // de rescate hay DOS caminos que le escriben al titular, y el segundo tiene que registrar su
    // fila en `athos_actions` igual que el primero. Los topes anti-loop —8 por chat por hora, y el
    // diario— se cuentan sobre esa tabla, no sobre `whatsapp_messages`. Un mensaje que sale sin
    // dejar su fila no cuenta, y entonces el arreglo del silencio abriría un bucle: el defecto
    // opuesto, y peor, porque éste sí se le nota al titular.
    //
    // Vive DENTRO de esta función a propósito: `auto-reply-no-duplica.test.ts` lee este archivo
    // entero para fijar el orden de la reserva atómica, y sacarlo a otro módulo lo dejaría ciego.
    const responder = async (texto: string, comoRescate: boolean) => {
      // ESTO ES ATHOS ESCRIBIENDO, y pasa por la guarda de destinos. Desde el 28-ago la guarda
      // reconoce dos puertas: titular registrado, o un número que le haya escrito a la clínica —
      // y éste es siempre lo segundo, porque estamos RESPONDIENDO a su entrante. O sea que un
      // desconocido que pregunta el horario ya recibe su respuesta; lo que sigue cerrado es que
      // Athos INICIE conversación con un número que nunca escribió.
      const { waMessageId: sentId, message } = await sendWhatsAppText(clinicId, fromPhone, texto, {
        ownerId: owner?.id ?? null,
        sentBy: null,
        agentMode: "auto",
        origen: "athos",
      })

      // Registro de la acción auto (ejecutada) + auditoría.
      const { data: action } = await admin
        .from("athos_actions")
        .insert({
          clinic_id: clinicId,
          owner_id: owner?.id ?? null,
          // MISMA variable que usa el freno horario: si estos dos valores divergen, el anti-loop
          // deja de contar y el titular puede recibir más de 8 respuestas por hora.
          conversation_key: conversationKey,
          source: "auto",
          tool_name: "send_whatsapp_message",
          payload: { to_phone: conversationKey, body: texto, in_reply_to: waMessageId, rescate: comoRescate },
          summary: `${comoRescate ? "Rescate automático" : "Respuesta automática"}: "${texto.length > 100 ? `${texto.slice(0, 99)}…` : texto}"`,
          risk: "auto",
          status: "executed",
          // El rescate no lo redactó ningún modelo —es un literal del repo— y decir lo contrario en
          // la traza haría buscar en el lugar equivocado el día que una frase moleste.
          proposed_by_model: comoRescate ? null : elegido.modelId,
          executed_at: new Date().toISOString(),
          result: { wa_message_id: sentId, message_id: message?.id ?? null },
        })
        .select("id")
        .single()
      await admin.from("audit_logs").insert({
        clinic_id: clinicId,
        action: "athos_action.auto_executed",
        table_name: "athos_actions",
        record_id: (action as { id: string } | null)?.id ?? null,
        payload: { in_reply_to: waMessageId, wa_message_id: sentId, rescate: comoRescate },
      })
    }

    const text = result.text.trim()
    if (!text || text === "NO_REPLY" || text.includes("NO_REPLY")) {
      // Con tools aparece un caso que antes no existía: que se agoten los pasos llamando
      // herramientas y no quede texto final. Se loguea, porque si pasa seguido es que `stepCountIs`
      // quedó corto. Si además se propuso una cita, la tarjeta ya está en la app y el vet la ve.
      if (!text && result.steps.some((s) => s.toolCalls.length > 0)) {
        console.warn("whatsapp/auto-reply: se llamaron tools y no quedó texto para el titular")
      }

      // ── EL SILENCIO DEJA DE SER EL COMODÍN PARA TODO ──────────────────────────────────────────
      //
      // Callarse sigue siendo lo correcto para cualquier cosa clínica, precios o quejas, y ése sigue
      // siendo el camino por defecto: `respuestaDeRescate` devuelve `null` salvo que haya un
      // agendamiento en curso. Lo que cambia es el caso del 30-ago —un titular a mitad de una cita
      // comiéndose cuatro silencios seguidos—, y ahí sale un literal del repo, nunca texto del modelo.
      const rescate = respuestaDeRescate(
        { citaEnCurso: hayCitaEnCurso(intencion), datos: datosDelTurno, mensajesSinAvance: sinAvance },
        sinHorarios ? "sin_horarios" : "sin_texto",
      )
      if (rescate) {
        await responder(rescate, true)
        await guardarConversacion({
          clinicId,
          conversationKey,
          intencion,
          // Si ya fue el rescate de rendirse, la conversación queda del vet y no se insiste más.
          estado: sinAvance >= TURNOS_ANTES_DE_ENTREGAR ? "entregada_al_vet" : "recolectando",
          datos: datosDelTurno,
          mensajesSinAvance: sinAvance,
          motivo: sinHorarios
            ? "sin_horarios"
            : sinAvance >= TURNOS_ANTES_DE_ENTREGAR
              ? "sin_avance"
              : null,
        })
        return
      }

      // Sin cita abierta: silencio, igual que siempre. El mensaje queda sin leer para el vet.
      await guardarConversacion({
        clinicId,
        conversationKey,
        intencion,
        estado: "recolectando",
        datos: datosDelTurno,
        mensajesSinAvance: sinAvance,
      })
      return
    }

    await responder(text, false)
    await guardarConversacion({
      clinicId,
      conversationKey,
      intencion,
      // Sin datos que falten, el turno siguiente es la confirmación: la persona tiene que decir que
      // sí antes de que se pida la cita.
      estado: faltantes(datosDelTurno).length === 0 ? "confirmando" : "recolectando",
      datos: datosDelTurno,
      mensajesSinAvance: sinAvance,
    })
  } catch (e) {
    // El modo auto NUNCA rompe el webhook: silencio y el mensaje queda para el vet.
    console.error("whatsapp/auto-reply:", e)
  }
}

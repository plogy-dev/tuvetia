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

import { generateText } from "ai"

import { createAdminClient } from "@/lib/supabase/admin"
import { autoModel } from "@/lib/athos-agent/model"
import { registrarUso } from "@/lib/athos-agent/usage"
import { sendWhatsAppText } from "./send-message"
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
    .select("agent_mode, auto_daily_limit, status, connected_at")
    .eq("clinic_id", clinicId)
    .maybeSingle()
  const cfg = integ as {
    agent_mode: string
    auto_daily_limit: number
    status: string
    connected_at: string | null
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
  if ((daily ?? 0) >= effectiveDailyLimit) return
  if ((hourly ?? 0) >= MAX_PER_HOUR_PER_CONVERSATION) return

  // Contexto: clínica + horarios reales + hilo reciente + titular (clinic_id explícito SIEMPRE).
  const [{ data: clinic }, { data: hours }, { data: thread }, { data: ownerRows }] = await Promise.all([
    admin.from("clinics").select("name").eq("id", clinicId).maybeSingle(),
    admin
      .from("clinic_hours")
      .select("weekday, opens_at, closes_at")
      .eq("clinic_id", clinicId)
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
  ])
  const owner = (ownerRows as { id: string; full_name: string }[] | null)?.[0] ?? null
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

  try {
    const result = await generateText({
      model: elegido.model,
      maxOutputTokens: 250,
      system: `Eres el asistente de WhatsApp de la clínica veterinaria "${(clinic as { name: string } | null)?.name ?? "la clínica"}" (Colombia, tuteo).

Decide si el ÚLTIMO mensaje del titular es respondible automáticamente y, si lo es, responde.

RESPONDIBLE (responde tú): saludos, horarios de atención, ubicación/cómo agendar, pedir cita (indica que un humano confirmará el horario), agradecimientos.
NO RESPONDIBLE (guarda silencio): CUALQUIER cosa clínica (síntomas, medicamentos, dosis, urgencias), precios, quejas, pagos, o cualquier duda — ante la mínima duda, silencio.

Si NO es respondible, responde EXACTAMENTE: NO_REPLY
Si es respondible: SOLO el texto del mensaje (1-3 frases, cálido, sin markdown, sin firmar).
Reglas duras: nunca inventes horarios/precios/direcciones. Horarios reales de la clínica: ${hoursText || "NO CONFIGURADOS (no menciones horarios)"}.
Si el titular pide cita: dile que con gusto, que un miembro del equipo le confirma el horario en breve.`,
      messages: [
        {
          role: "user",
          content: `Conversación reciente:\n${threadText}\n\n(El último mensaje del titular es el que debes evaluar.)`,
        },
      ],
    })
    // Se registra ANTES de decidir si se responde: el NO_REPLY también costó tokens, y no contarlo
    // subestimaría el gasto del modo auto justo en el caso más frecuente.
    void registrarUso({
      clinicId,
      userId: null, // modo auto: no hay vet detrás
      surface: "auto_reply",
      elegido,
      usage: result.usage,
    })

    const text = result.text.trim()
    if (!text || text === "NO_REPLY" || text.includes("NO_REPLY")) return

    const { waMessageId: sentId, message } = await sendWhatsAppText(clinicId, fromPhone, text, {
      ownerId: owner?.id ?? null,
      sentBy: null,
      agentMode: "auto",
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
        payload: { to_phone: conversationKey, body: text, in_reply_to: waMessageId },
        summary: `Respuesta automática: "${text.length > 100 ? `${text.slice(0, 99)}…` : text}"`,
        risk: "auto",
        status: "executed",
        proposed_by_model: elegido.modelId,
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
      payload: { in_reply_to: waMessageId, wa_message_id: sentId },
    })
  } catch (e) {
    // El modo auto NUNCA rompe el webhook: silencio y el mensaje queda para el vet.
    console.error("whatsapp/auto-reply:", e)
  }
}

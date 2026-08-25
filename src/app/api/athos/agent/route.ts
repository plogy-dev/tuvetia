import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import {
  densidadClinica,
  sanearHistorial,
  esConsultaClinica,
  preguntasDuplicadas,
  recortarHistorial,
  textoDe,
  turnoAGuardar,
} from "@/lib/athos-agent/conversacion"
import { ATHOS_AGENT_SYSTEM_PROMPT } from "@/lib/athos-agent/system-prompt"
import { buildAthosTools } from "@/lib/athos-agent/tools"
import { agentModel } from "@/lib/athos-agent/model"
import { clasificarFallo } from "@/lib/athos-agent/cascada"
import { registrarUso } from "@/lib/athos-agent/usage"
import { rateLimit } from "@/lib/athos-agent/rate-limit"
import { consultarPresupuesto, mensajeSinCupo } from "@/lib/athos-agent/presupuesto"
import { clinicaDeLaSesion, requiereCapacidad } from "@/lib/api/clinica-de-la-sesion"
import { bloqueDeContextoRuntime } from "@/lib/athos-agent/contexto-runtime"
import { senalesDeLaClinica } from "@/lib/senales/consultar"
import type { AgentContext } from "@/lib/athos-agent/actions"

export const runtime = "nodejs"
// 300 y no 60 (2026-08-26): con 60, un turno con dos-tres tools lentas + la velocidad de salida
// del proveedor cruzaba el tope y Vercel MATABA la función a mitad de stream — el vet veía a
// Athos "colgado en blanco" (reportado dos veces en las pruebas del 25-ago; athos_messages
// registra turnos de 114s y 160s). El tope alto es la red de seguridad, no la meta: la latencia
// se ataca recortando el historial (recortarHistorial) y midiendo cada turno (duration_ms).
export const maxDuration = 300

// Agente Athos (Vercel AI SDK): corre con la SESIÓN del vet — las tools de lectura pasan por RLS
// y las de escritura solo PROPONEN acciones (athos_actions) que el vet aprueba en una tarjeta.
// El RAG queda en athos-service y se consume como tool remota (search_clinical_evidence).
// Proveedor/modelo por env (Anthropic o DeepSeek) — ver lib/athos-agent/model.ts.

const BodySchema = z.object({
  messages: z.array(z.any()),
  patientId: z.string().uuid().nullable().optional(),
  // `auto` no está y es correcto: el modo automático no pasa por esta ruta (usa auto-tools con
  // service_role). Lo que sí faltaba era `widget` y `onboarding`, que hasta la 0057 mandaban
  // "chat" mintiendo.
  source: z.enum(["chat", "inbox", "widget", "onboarding"]).default("chat"),
  conversationKey: z.string().nullable().optional(),
  // QUÉ PANTALLA ESTÁ MIRANDO EL VET. Lo deriva el cliente de la ruta (`derivarContexto`), así que
  // llega del navegador y NO se le cree: se valida con la misma forma del tipo y los ids se exigen
  // uuid. Lo peor que puede pasar con un contexto falseado es que el modelo mire una pantalla que
  // no es — no da acceso a nada, porque toda lectura sigue pasando por la RLS de la sesión.
  contexto: z
    .discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("paciente"), patientId: z.string().uuid() }),
      z.object({ tipo: z.literal("consulta"), consultaId: z.string().uuid() }),
      z.object({ tipo: z.literal("asistente"), patientId: z.string().uuid().nullable() }),
      z.object({ tipo: z.literal("titulares") }),
      z.object({ tipo: z.literal("agenda") }),
      z.object({ tipo: z.literal("comunicaciones") }),
      z.object({ tipo: z.literal("facturacion"), facturaId: z.string().uuid().nullable() }),
      z.object({ tipo: z.literal("general") }),
    ])
    .nullable()
    .optional(),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response("No autenticado", { status: 401 })

  const rl = rateLimit(`athos-agent:${user.id}`, 30, 60_000)
  if (!rl.allowed) {
    return new Response("Demasiadas solicitudes seguidas. Espera unos segundos.", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSeconds) },
    })
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return new Response("Bad request", { status: 400 })
  const { messages, patientId, source, conversationKey, contexto } = parsed.data

  // Resuelve la clínica Y comprueba que la cuenta siga activa, en el mismo select. Antes esto sólo
  // sacaba `clinic_id`, y una cuenta desactivada llegaba hasta acá con su JWT todavía válido y
  // gastaba una llamada al modelo antes de que la RLS le negara los datos.
  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return new Response(sesion.mensaje, { status: sesion.status })
  const { clinicId } = sesion

  // EL PLAN, ANTES QUE EL TOPE Y ANTES QUE TODO LO DEMÁS. Athos es de Pro; una clínica free no
  // llega a armar el pedido. Va acá arriba y no más abajo por el mismo motivo por el que existe la
  // comprobación de cuenta activa: lo que se corta es el GASTO, no la respuesta.
  //
  // La cabecera `X-Requiere-Plan` es lo que le permite al compositor distinguir este 402 —"tu plan
  // no lo incluye", que abre la ventana de invitación a Pro— del 402 de más abajo, que es "se te
  // acabó el cupo del mes" y se resuelve esperando. El cuerpo es texto plano porque esta ruta
  // responde un stream, no JSON.
  const conPlan = requiereCapacidad(sesion.plan, "athos")
  if (!conPlan.ok) {
    return new Response(conPlan.mensaje, {
      status: conPlan.status,
      headers: { "X-Requiere-Plan": "pro", "X-Capacidad": conPlan.capacidad },
    })
  }

  // TOPE MENSUAL DE LA CLÍNICA. Distinto del `rateLimit` de arriba: aquél corta la ráfaga de UN
  // usuario en memoria, éste corta el consumo acumulado de la CLÍNICA contra la base — que es lo
  // único que sobrevive a que Vercel levante otra lambda.
  //
  // 402 y no 429: no es "demasiado rápido, esperá unos segundos", es "se acabó el cupo del mes".
  // Confundirlos hace que el front muestre "reintentá" sobre algo que no se arregla reintentando.
  const presupuesto = await consultarPresupuesto(clinicId)
  if (!presupuesto.permitido) {
    return new Response(mensajeSinCupo(presupuesto), { status: 402 })
  }

  // Athos firmaba los correos como "Veterinaria" a secas porque nunca supo el nombre de la clínica
  // ni el del vet. Con esto puede firmar de verdad — y un correo a un titular tiene que decir de
  // qué veterinaria viene, o parece spam.
  //
  // Las SEÑALES van en el mismo `Promise.all` a propósito: son cuatro consultas más, y en serie
  // sumarían round-trips antes del primer token. En paralelo con lo que ya se pedía, el costo es el
  // de la consulta más lenta del grupo. Cero IA — todo sale de la base.
  const todayISO = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10) // hora Colombia
  const [{ data: clinica }, { data: sesionSupabase }, senales] = await Promise.all([
    supabase.from("clinics").select("name").eq("id", clinicId).maybeSingle(),
    supabase.auth.getSession(),
    senalesDeLaClinica(supabase, clinicId, todayISO),
  ])
  const clinicName = (clinica as { name: string } | null)?.name?.trim() || null
  const session = sesionSupabase.session

  // UNA sola resolución del modelo para toda la petición: `elegido.model` es el que atiende y
  // `elegido.modelId` el que se persiste. Antes eran dos llamadas distintas (`agentModel()` acá y
  // `agentModelId()` allá), que con la cascada encendida podían no coincidir. El `get` deja que la
  // tool lea el valor TARDE: si entró el respaldo, la cascada ya reescribió `modelId` para entonces.
  const elegido = agentModel()
  const ctx: AgentContext = {
    userId: user.id,
    clinicId,
    source,
    conversationKey: conversationKey ?? patientId ?? null,
    patientId: patientId ?? null,
    accessToken: session?.access_token ?? null,
    get model() {
      return elegido.modelId
    },
  }

  // PROPORCIONALIDAD (defecto reportado el 2026-07-31): el agente soltaba diferenciales completos
  // ante "un perro que vomita". La densidad se cuenta ACÁ, determinística, y entra al prompt como
  // contexto de runtime: contar señales clínicas es barato y reproducible, y no gasta un token en
  // preguntárselo al modelo.
  //
  // Sólo aplica a consultas CLÍNICAS: pedirle más datos a "¿qué tengo mañana?" sería absurdo.
  const ultimaDelVet = [...(messages as UIMessage[])].reverse().find((m) => m.role === "user")
  const textoUltima = ultimaDelVet ? textoDe(ultimaDelVet) : ""
  const densidad = densidadClinica(textoUltima)
  const avisoDensidad =
    esConsultaClinica(textoUltima) && densidad.nivel === "escaso"
      ? `\n- ⚠️ El vet dio POCOS datos clínicos (${densidad.datos}: ${densidad.señales.join(", ") || "ninguno"}). NO desarrolles diferenciales, protocolos ni dosis: haz 2-3 preguntas de clarificación y nada más.`
      : ""

  // El bloque salió a `lib/athos-agent/contexto-runtime.ts`: era un template literal de once líneas
  // acá adentro, imposible de probar sin levantar la ruta. Y es justo lo que hay que poder probar —
  // si una línea deja de llegar al prompt, el modelo pierde una capacidad y no falla nada.
  const system = `${ATHOS_AGENT_SYSTEM_PROMPT}\n\n${bloqueDeContextoRuntime({
    hoyISO: todayISO,
    clinica: clinicName,
    vet: sesion.fullName,
    patientId,
    contexto,
    source,
    avisoDensidad,
    pendientes: senales.pendientes,
  })}`

  const t0 = Date.now()
  const result = streamText({
    model: elegido.model,
    system,
    // `recortarHistorial` acota lo que VE el modelo (medido: 22-57k tokens de entrada por turno
    // reenviando el hilo entero con tool parts — ver conversacion.ts); `sanearHistorial` desactiva
    // los turnos VIEJOS que dicen haber propuesto algo sin haberlo hecho. La persistencia de abajo
    // sigue usando `messages` completo: el recorte es del camino al modelo, no de la conversación.
    messages: await convertToModelMessages(sanearHistorial(recortarHistorial(messages as UIMessage[]))),
    maxOutputTokens: 2000,
    tools: buildAthosTools(supabase, ctx),
    stopWhen: stepCountIs(8),
    // Consumo: va en el `onFinish` de streamText y no en el de `toUIMessageStreamResponse`, que no
    // recibe `usage`. `totalUsage` suma TODOS los pasos del loop de herramientas — con `stepCountIs(8)`
    // el usage del último paso contaría una fracción del gasto real.
    onFinish: ({ totalUsage }) => {
      void registrarUso({
        clinicId,
        userId: user.id,
        // Derivado de `source` y no fijo en "agent": esta ruta la usan ahora la pantalla del
        // asistente, la burbuja global, la bandeja de WhatsApp y el onboarding, y sumarlas todas
        // bajo una etiqueta hace incontestable la pregunta de cuánto cuesta cada superficie.
        surface: source === "widget" ? "widget" : "agent",
        elegido,
        usage: totalUsage,
        // Cuánto tardó el turno COMPLETO (loop de tools incluido): la cifra que faltaba para
        // diagnosticar "Athos tarda un minuto" con datos en vez de anécdota (migración 0087).
        duracionMs: Date.now() - t0,
      })
    },
  })

  // El AI SDK reemplaza CUALQUIER fallo por "An error occurred." si no se le dice qué mostrar. Eso
  // dejaba al veterinario con un mensaje que no ayuda y a nosotros sin rastro: una credencial sin
  // saldo, un límite de tasa del proveedor y un timeout se veían exactamente igual.
  //
  // Acá se hacen las dos cosas: el error COMPLETO va al log del servidor (Vercel), y al veterinario
  // se le devuelve la CLASE de fallo, que es lo que le permite decidir si reintentar o avisar.
  // Nunca se devuelve el mensaje crudo del proveedor: puede traer fragmentos de la petición.
  return result.toUIMessageStreamResponse({
    // MEMORIA ENTRE SESIONES (defecto reportado el 2026-07-31): esta ruta no persistía NADA. El
    // asistente precargaba el hilo desde `athos_messages`, pero ahí sólo escribía el chat de
    // athos-service — así que al recargar, el agente respondía "no tengo memoria previa".
    //
    // Se guarda en la MISMA tabla que ya lee `lib/athos-history.ts`: no hace falta una nueva, y así
    // el historial del asistente y el del chat quedan en un solo sitio. La RLS de `athos_messages`
    // (`clinic_id = private.my_clinic_id()`) deja escribir con la sesión del vet, sin service_role.
    //
    // Se guarda SÓLO el turno nuevo: el cliente reenvía el hilo entero en cada petición, así que
    // persistir `messages` completo duplicaría la conversación en cada mensaje.
    //
    // Best-effort: un fallo acá NO puede tumbar una respuesta que el vet ya leyó.
    onFinish: async ({ responseMessage, isAborted }) => {
      if (isAborted) return
      try {
        const turnos = turnoAGuardar(messages as UIMessage[], responseMessage)
        if (!turnos.length) return

        const { error } = await supabase.from("athos_messages").insert(
          turnos.map((turno) => ({
            clinic_id: clinicId,
            user_id: user.id,
            patient_id: patientId ?? null,
            role: turno.role,
            content: turno.content,
          })),
        )
        if (error) console.error("[athos/agent] no se pudo guardar el turno:", error.message)

        // Rastro del defecto de preguntas repetidas. NO reescribe la respuesta —ya se emitió por
        // streaming— pero deja medible si la regla del prompt se está cumpliendo.
        const repetidas = preguntasDuplicadas(
          turnos.find((t) => t.role === "assistant")?.content ?? "",
        )
        if (repetidas.length) {
          console.warn("[athos/agent] pidió el mismo dato más de una vez:", repetidas)
        }
      } catch (e) {
        console.error("[athos/agent] fallo al persistir el turno:", e)
      }
    },
    // El mensaje sale de `clasificarFallo`, la MISMA función que decide si la cascada cae al
    // respaldo. Antes esta ruta mantenía su propia lista de subcadenas y las dos se desincronizaron
    // en cuestión de horas: el arreglo de "rate limit" entró en `cascada.ts` y esta copia se quedó
    // con el `"rate"` viejo. Una sola taxonomía, dos consumidores.
    onError: (error) => {
      console.error("[athos/agent] falló la generación:", error)
      switch (clasificarFallo(error)) {
        case "saldo":
          return "El proveedor de IA rechazó la petición por saldo o cuota. Avisá al equipo técnico."
        case "credencial":
          return "La credencial del proveedor de IA no es válida. Avisá al equipo técnico."
        case "limite":
          return "El proveedor está limitando las peticiones. Esperá unos segundos y reintentá."
        case "servicio":
          return "El proveedor de IA está caído o sobrecargado. Reintentá en un momento."
        case "red":
          return "La respuesta tardó demasiado y se cortó. Reintentá."
        default:
          return "No se pudo generar la respuesta. El detalle quedó en el log del servidor."
      }
    },
  })
}

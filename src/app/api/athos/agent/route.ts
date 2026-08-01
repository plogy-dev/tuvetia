import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import {
  densidadClinica,
  esConsultaClinica,
  preguntasDuplicadas,
  textoDe,
  turnoAGuardar,
} from "@/lib/athos-agent/conversacion"
import { ATHOS_AGENT_SYSTEM_PROMPT } from "@/lib/athos-agent/system-prompt"
import { buildAthosTools } from "@/lib/athos-agent/tools"
import { agentModel } from "@/lib/athos-agent/model"
import { registrarUso } from "@/lib/athos-agent/usage"
import { rateLimit } from "@/lib/athos-agent/rate-limit"
import type { AgentContext } from "@/lib/athos-agent/actions"

export const runtime = "nodejs"
export const maxDuration = 60

// Agente Athos (Vercel AI SDK): corre con la SESIÓN del vet — las tools de lectura pasan por RLS
// y las de escritura solo PROPONEN acciones (athos_actions) que el vet aprueba en una tarjeta.
// El RAG queda en athos-service y se consume como tool remota (search_clinical_evidence).
// Proveedor/modelo por env (Anthropic o DeepSeek) — ver lib/athos-agent/model.ts.

const BodySchema = z.object({
  messages: z.array(z.any()),
  patientId: z.string().uuid().nullable().optional(),
  source: z.enum(["chat", "inbox"]).default("chat"),
  conversationKey: z.string().nullable().optional(),
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
  const { messages, patientId, source, conversationKey } = parsed.data

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return new Response("El usuario no tiene clínica", { status: 400 })

  const {
    data: { session },
  } = await supabase.auth.getSession()

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

  const todayISO = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10) // hora Colombia

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

  const system = `${ATHOS_AGENT_SYSTEM_PROMPT}\n\n# Contexto runtime\n\n- Fecha de hoy: ${todayISO} (hora de Colombia, UTC-5).${
    patientId ? `\n- Hay un paciente en contexto (id interno: ${patientId}) — usa get_patient_summary si lo necesitas.` : ""
  }${source === "inbox" ? "\n- Estás en la bandeja de WhatsApp: el objetivo típico es proponer una respuesta con send_whatsapp_message." : ""}${avisoDensidad}`

  const result = streamText({
    model: elegido.model,
    system,
    messages: await convertToModelMessages(messages as UIMessage[]),
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
        surface: "agent",
        elegido,
        usage: totalUsage,
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
    onError: (error) => {
      console.error("[athos/agent] falló la generación:", error)
      const msg = error instanceof Error ? error.message : String(error)
      const m = msg.toLowerCase()
      if (m.includes("credit") || m.includes("billing") || m.includes("quota") || m.includes("insufficient"))
        return "El proveedor de IA rechazó la petición por saldo o cuota. Avisá al equipo técnico."
      if (m.includes("api key") || m.includes("apikey") || m.includes("authentication") || m.includes("401"))
        return "La credencial del proveedor de IA no es válida. Avisá al equipo técnico."
      // "rate limit" completo: `"generated".includes("rate")` es true, así que con "rate" a secas
      // un fallo cualquiera que mencionara "generate" se le mostraba al vet como límite de tasa.
      if (m.includes("rate limit") || m.includes("rate_limit") || m.includes("429"))
        return "El proveedor está limitando las peticiones. Esperá unos segundos y reintentá."
      if (m.includes("timeout") || m.includes("aborted") || m.includes("etimedout"))
        return "La respuesta tardó demasiado y se cortó. Reintentá."
      return "No se pudo generar la respuesta. El detalle quedó en el log del servidor."
    },
  })
}

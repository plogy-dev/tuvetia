import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { ATHOS_AGENT_SYSTEM_PROMPT } from "@/lib/athos-agent/system-prompt"
import { buildAthosTools } from "@/lib/athos-agent/tools"
import { agentModel, agentModelId } from "@/lib/athos-agent/model"
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

  const ctx: AgentContext = {
    userId: user.id,
    clinicId,
    source,
    conversationKey: conversationKey ?? patientId ?? null,
    patientId: patientId ?? null,
    accessToken: session?.access_token ?? null,
    model: agentModelId(),
  }

  const todayISO = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10) // hora Colombia
  const system = `${ATHOS_AGENT_SYSTEM_PROMPT}\n\n# Contexto runtime\n\n- Fecha de hoy: ${todayISO} (hora de Colombia, UTC-5).${
    patientId ? `\n- Hay un paciente en contexto (id interno: ${patientId}) — usa get_patient_summary si lo necesitas.` : ""
  }${source === "inbox" ? "\n- Estás en la bandeja de WhatsApp: el objetivo típico es proponer una respuesta con send_whatsapp_message." : ""}`

  const result = streamText({
    model: agentModel(),
    system,
    messages: await convertToModelMessages(messages as UIMessage[]),
    maxOutputTokens: 2000,
    tools: buildAthosTools(supabase, ctx),
    stopWhen: stepCountIs(8),
  })

  // El AI SDK reemplaza CUALQUIER fallo por "An error occurred." si no se le dice qué mostrar. Eso
  // dejaba al veterinario con un mensaje que no ayuda y a nosotros sin rastro: una credencial sin
  // saldo, un límite de tasa del proveedor y un timeout se veían exactamente igual.
  //
  // Acá se hacen las dos cosas: el error COMPLETO va al log del servidor (Vercel), y al veterinario
  // se le devuelve la CLASE de fallo, que es lo que le permite decidir si reintentar o avisar.
  // Nunca se devuelve el mensaje crudo del proveedor: puede traer fragmentos de la petición.
  return result.toUIMessageStreamResponse({
    onError: (error) => {
      console.error("[athos/agent] falló la generación:", error)
      const msg = error instanceof Error ? error.message : String(error)
      const m = msg.toLowerCase()
      if (m.includes("credit") || m.includes("billing") || m.includes("quota") || m.includes("insufficient"))
        return "El proveedor de IA rechazó la petición por saldo o cuota. Avisá al equipo técnico."
      if (m.includes("api key") || m.includes("apikey") || m.includes("authentication") || m.includes("401"))
        return "La credencial del proveedor de IA no es válida. Avisá al equipo técnico."
      if (m.includes("rate") || m.includes("429"))
        return "El proveedor está limitando las peticiones. Esperá unos segundos y reintentá."
      if (m.includes("timeout") || m.includes("aborted") || m.includes("etimedout"))
        return "La respuesta tardó demasiado y se cortó. Reintentá."
      return "No se pudo generar la respuesta. El detalle quedó en el log del servidor."
    },
  })
}

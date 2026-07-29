import { generateText, stepCountIs } from "ai"
import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { ATHOS_AGENT_SYSTEM_PROMPT } from "@/lib/athos-agent/system-prompt"
import { buildAthosTools } from "@/lib/athos-agent/tools"
import { agentModel, agentModelId } from "@/lib/athos-agent/model"
import { rateLimit } from "@/lib/athos-agent/rate-limit"
import type { AgentContext } from "@/lib/athos-agent/actions"

export const runtime = "nodejs"
export const maxDuration = 60

// Botón "Sugerir" de la bandeja: el agente lee la conversación y PROPONE una respuesta —
// persistida en athos_actions (sobrevive recargas, queda auditada) y devuelta como borrador
// editable para el composer. El envío es la aprobación de esa acción.

const BodySchema = z.object({
  phone: z.string().min(6),
  owner_id: z.string().uuid().nullable().optional(),
  owner_name: z.string().nullable().optional(),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const rl = rateLimit(`athos-suggest:${user.id}`, 15, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: "Demasiadas solicitudes seguidas" }, { status: 429 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 })
  const { phone, owner_id, owner_name } = parsed.data

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const digitsPhone = phone.replace(/\D/g, "")
  const ctx: AgentContext = {
    userId: user.id,
    clinicId,
    source: "inbox",
    conversationKey: digitsPhone,
    patientId: null,
    accessToken: session?.access_token ?? null,
    model: agentModelId(),
  }

  try {
    const result = await generateText({
      model: agentModel(),
      system: `${ATHOS_AGENT_SYSTEM_PROMPT}\n\n# Tarea puntual\n\nEstás en la bandeja de WhatsApp. Lee la conversación con search_whatsapp_conversation (teléfono: ${digitsPhone}) y, si ayuda, identifica al titular con get_owner_by_phone y consulta horarios/cupos reales. Luego PROPONE exactamente UNA respuesta con send_whatsapp_message (to_phone: ${digitsPhone}${owner_id ? `, owner_id: ${owner_id}` : ""}). Tono WhatsApp: 1-3 frases, cálido, sin markdown. Nunca diagnósticos ni dosis por chat; nunca inventes horarios o precios — si no los tienes por tools, no los menciones.${owner_name ? ` El titular se llama ${owner_name}.` : ""}`,
      messages: [{ role: "user", content: "Sugiere la respuesta para esta conversación." }],
      tools: buildAthosTools(supabase, ctx),
      stopWhen: stepCountIs(5),
      maxOutputTokens: 600,
    })

    // Extraer la propuesta creada por la tool (action_id + texto) de los pasos.
    let actionId: string | null = null
    let draft: string | null = null
    for (const step of result.steps) {
      for (const tc of step.toolCalls ?? []) {
        if (tc.toolName === "send_whatsapp_message") {
          draft = String((tc.input as { body?: string }).body ?? "")
        }
      }
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName === "send_whatsapp_message") {
          const out = tr.output as { action_id?: string }
          if (out?.action_id) actionId = out.action_id
        }
      }
    }
    if (!draft || !actionId) {
      return NextResponse.json(
        { error: "Athos no pudo proponer una respuesta para esta conversación." },
        { status: 502 },
      )
    }
    return NextResponse.json({ draft, action_id: actionId })
  } catch (e) {
    console.error("athos/suggest-reply:", e)
    return NextResponse.json({ error: "No se pudo generar la sugerencia." }, { status: 502 })
  }
}

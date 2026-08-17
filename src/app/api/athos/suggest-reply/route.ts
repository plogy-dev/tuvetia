import { generateText, stepCountIs } from "ai"
import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { clinicaDeLaSesion, requiereCapacidad } from "@/lib/api/clinica-de-la-sesion"
import { ATHOS_AGENT_SYSTEM_PROMPT } from "@/lib/athos-agent/system-prompt"
import { buildAthosTools } from "@/lib/athos-agent/tools"
import { agentModel } from "@/lib/athos-agent/model"
import { registrarUso } from "@/lib/athos-agent/usage"
import { rateLimit } from "@/lib/athos-agent/rate-limit"
import { consultarPresupuesto, mensajeSinCupo } from "@/lib/athos-agent/presupuesto"
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

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  const { clinicId } = sesion

  // La sugerencia de respuesta ES Athos, aunque viva dentro de Comunicaciones. Va a Pro por lo
  // mismo que el chat: cuesta una llamada al modelo cada vez que alguien la pide.
  //
  // `requierePlan` en el cuerpo es lo que le permite a la bandeja abrir la ventana de invitación en
  // vez de mostrar el error como un fallo de envío.
  const conPlan = requiereCapacidad(sesion.plan, "sugerencia-whatsapp")
  if (!conPlan.ok) {
    return NextResponse.json(
      { error: conPlan.mensaje, requierePlan: "pro", capacidad: conPlan.capacidad },
      { status: conPlan.status },
    )
  }

  // El mismo tope mensual de la clínica que en `/api/athos/agent`: es UN cupo compartido entre
  // todas las superficies, no uno por pantalla. Sugerir una respuesta en la bandeja cuesta una
  // llamada al modelo igual que una pregunta en el chat.
  const presupuesto = await consultarPresupuesto(clinicId)
  if (!presupuesto.permitido) {
    return NextResponse.json({ error: mensajeSinCupo(presupuesto) }, { status: 402 })
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const digitsPhone = phone.replace(/\D/g, "")

  // Conversación SIN mensajes: no hay nada que responder, y el agente no debe inventar un primer
  // contacto — la regla inbound-first de `docs/EVOLUTION.md` ("el agente solo responde entrantes;
  // no hay envíos masivos ni en frío") es una de las protecciones anti-baneo del número.
  //
  // Se corta ACÁ y no en el modelo por dos razones: el modelo ya declinaba (correcto), pero el
  // error resultante —"Athos no pudo proponer una respuesta"— se lee como una falla del sistema
  // cuando es la respuesta correcta; y además se ahorra la llamada al LLM.
  // Mismo criterio de búsqueda que `search_whatsapp_conversation`: los últimos 10 dígitos, que
  // vienen ya normalizados (solo dígitos), y RLS acota a la clínica.
  const last10 = digitsPhone.slice(-10)
  const { count: mensajes } = await supabase
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .or(`wa_phone_from.ilike.%${last10},wa_phone_to.ilike.%${last10}`)
  if (!mensajes) {
    return NextResponse.json(
      {
        error:
          "Esta conversación todavía no tiene mensajes. Athos redacta a partir de lo que escribió el titular, así que no propone el primer contacto: escríbele tú y podrás pedirle un borrador desde el segundo mensaje.",
      },
      { status: 422 },
    )
  }

  // Una sola resolución del modelo, y `model` se lee TARDE (dentro de la tool que inserta la
  // propuesta): si la cascada cayó al respaldo, `proposed_by_model` guarda quién respondió de
  // verdad. Ver `athos-agent/model.ts`.
  const elegido = agentModel()
  const ctx: AgentContext = {
    userId: user.id,
    clinicId,
    source: "inbox",
    conversationKey: digitsPhone,
    patientId: null,
    accessToken: session?.access_token ?? null,
    get model() {
      return elegido.modelId
    },
  }

  try {
    const result = await generateText({
      model: elegido.model,
      system: `${ATHOS_AGENT_SYSTEM_PROMPT}\n\n# Tarea puntual\n\nEstás en la bandeja de WhatsApp. Lee la conversación con search_whatsapp_conversation (teléfono: ${digitsPhone}) y, si ayuda, identifica al titular con get_owner_by_phone y consulta horarios/cupos reales. Luego PROPONE exactamente UNA respuesta con send_whatsapp_message (to_phone: ${digitsPhone}${owner_id ? `, owner_id: ${owner_id}` : ""}). Tono WhatsApp: 1-3 frases, cálido, sin markdown. Nunca diagnósticos ni dosis por chat; nunca inventes horarios o precios — si no los tienes por tools, no los menciones.${owner_name ? ` El titular se llama ${owner_name}.` : ""}`,
      messages: [{ role: "user", content: "Sugiere la respuesta para esta conversación." }],
      tools: buildAthosTools(supabase, ctx),
      stopWhen: stepCountIs(5),
      maxOutputTokens: 600,
    })

    // `totalUsage` (todos los pasos del loop), no `usage` (sólo el último): con `stepCountIs(5)` el
    // último paso es una fracción del gasto. Best-effort — `registrarUso` no lanza.
    void registrarUso({
      clinicId,
      userId: user.id,
      surface: "suggest_reply",
      elegido,
      usage: result.totalUsage,
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
      // El modelo corrió pero no llamó a `send_whatsapp_message`. Con la conversación vacía ya
      // cortamos arriba, así que acá es otra cosa: el modelo decidió que no correspondía responder
      // (p. ej. el último mensaje no pide nada) o se quedó sin pasos. Se dice qué hacer, no solo
      // que falló.
      return NextResponse.json(
        {
          error:
            "Athos no propuso una respuesta para esta conversación. Suele pasar cuando el último mensaje no pide nada concreto; escribe tú el borrador o dale más contexto.",
        },
        { status: 502 },
      )
    }
    return NextResponse.json({ draft, action_id: actionId })
  } catch (e) {
    console.error("athos/suggest-reply:", e)
    return NextResponse.json({ error: "No se pudo generar la sugerencia." }, { status: 502 })
  }
}

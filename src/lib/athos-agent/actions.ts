// Acciones propuestas por Athos — helper de inserción y tipos compartidos.
// El agente NUNCA ejecuta escrituras: cada tool de escritura inserta una fila 'proposed' en
// athos_actions (service_role; la tabla no tiene policy de INSERT) y el vet la aprueba en la UI.
// La ejecución vive en /api/athos/actions/[id]/execute con la SESIÓN del vet aprobador.

import { createAdminClient } from "@/lib/supabase/admin"

export type AgentSource = "chat" | "inbox" | "auto"

export type AgentContext = {
  userId: string | null // null en modo auto
  clinicId: string
  source: AgentSource
  conversationKey: string | null // teléfono (inbox) o patient_id (chat)
  patientId: string | null
  accessToken: string | null // JWT de la sesión — para tools remotas a athos-service
  model: string
}

export type ProposedActionResult =
  | {
      action_id: string
      status: "proposed"
      summary: string
      note: string
    }
  | { error: string }

export async function proposeAction(
  ctx: AgentContext,
  toolName: string,
  payload: Record<string, unknown>,
  summary: string,
  refs: { patientId?: string | null; ownerId?: string | null } = {},
): Promise<ProposedActionResult> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("athos_actions")
    .insert({
      clinic_id: ctx.clinicId,
      patient_id: refs.patientId ?? ctx.patientId ?? null,
      owner_id: refs.ownerId ?? null,
      conversation_key: ctx.conversationKey,
      source: ctx.source,
      tool_name: toolName,
      payload,
      summary,
      risk: "approval",
      proposed_by_model: ctx.model,
      created_by: ctx.userId,
    })
    .select("id")
    .single()
  if (error) return { error: `No se pudo registrar la propuesta: ${error.message}` }
  return {
    action_id: (data as { id: string }).id,
    status: "proposed",
    summary,
    note: "Acción registrada como PROPUESTA — pendiente de aprobación del veterinario en la tarjeta. No está ejecutada.",
  }
}

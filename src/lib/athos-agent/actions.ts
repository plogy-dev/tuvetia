// Acciones propuestas por Athos — helper de inserción y tipos compartidos.
// El agente NUNCA ejecuta escrituras: cada tool de escritura inserta una fila 'proposed' en
// athos_actions (service_role; la tabla no tiene policy de INSERT) y el vet la aprueba en la UI.
// La ejecución vive en /api/athos/actions/[id]/execute con la SESIÓN del vet aprobador.

import { createAdminClient } from "@/lib/supabase/admin"

// Desde dónde se PROPUSO la acción. `widget` es la burbuja que vive en todas las pantallas, y se
// distingue de `chat` porque "el vet dice que Athos le agendó algo, ¿desde dónde lo pidió?" es la
// primera pregunta de soporte y esta tabla es el expediente. Debe coincidir con el check de la 0057.
export type AgentSource = "chat" | "inbox" | "auto" | "widget" | "onboarding"

export type AgentContext = {
  userId: string | null // null en modo auto
  clinicId: string
  source: AgentSource
  conversationKey: string | null // teléfono (inbox) o patient_id (chat)
  patientId: string | null
  accessToken: string | null // JWT de la sesión — para tools remotas a athos-service
  model: string
}

/**
 * Lo que el modelo lee cuando propone algo, y de donde saca que la acción NO está hecha.
 *
 * Se exporta —en vez de vivir inline en el `return`— porque el banco adversario le tiene que
 * contestar al modelo EXACTAMENTE esto. Si el banco improvisara otra nota, el modelo razonaría
 * distinto a partir de ahí y estaríamos midiendo a un agente que no existe. Antes había una copia
 * literal en `adversarios/arnes.ts` con un test que comparaba las dos cadenas; esto lo vuelve
 * imposible de desincronizar.
 */
export const NOTA_PROPUESTA =
  "Acción registrada como PROPUESTA — pendiente de aprobación del veterinario en la tarjeta. No está ejecutada."

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
  refs: {
    patientId?: string | null
    ownerId?: string | null
    /**
     * Dónde tiene que aparecer la propuesta, si no es la conversación en curso.
     *
     * Por defecto es `ctx.conversationKey` (el teléfono en la bandeja de WhatsApp, el patient_id en
     * el chat). Una propuesta de correo pertenece a SU hilo: sin esto, pedirle a Athos desde el chat
     * que responda un correo dejaría la tarjeta colgada del chat y nunca aparecería en la bandeja
     * de correo, que es donde el vet la va a buscar.
     */
    conversationKey?: string | null
  } = {},
): Promise<ProposedActionResult> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("athos_actions")
    .insert({
      clinic_id: ctx.clinicId,
      patient_id: refs.patientId ?? ctx.patientId ?? null,
      owner_id: refs.ownerId ?? null,
      conversation_key: refs.conversationKey ?? ctx.conversationKey,
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
    note: NOTA_PROPUESTA,
  }
}

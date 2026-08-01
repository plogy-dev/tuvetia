import "server-only"

// Registro de consumo del agente que vive en Next. Escribe y punto: no sabe de costos ni de
// tarifas — de eso se encarga `/admin/costos`, igual que `rag_answer_log` no sabe de dinero.
//
// Existe porque este consumo era INVISIBLE: el agente con herramientas, la sugerencia de WhatsApp,
// el modo auto y la visión de facturas llaman al proveedor desde Next y no dejaban rastro en
// ninguna tabla. `rag_answer_log` sólo lo escribe athos-service, así que el panel no podía cobrar
// Anthropic — el dato no existía. Tabla y RLS: migración 0046.

import { createAdminClient } from "@/lib/supabase/admin"
import type { ModeloElegido } from "@/lib/athos-agent/model"

/** Las seis superficies de Next que gastan IA. Debe coincidir con el `check` de la 0046. */
export type SuperficieDeUso =
  | "agent"
  | "suggest_reply"
  | "auto_reply"
  | "cartera_inbound"
  | "vision_recipe"
  | "vision_purchase"

/** Lo que devuelve `result.usage` del AI SDK (`LanguageModelUsage`). */
type UsoDeTokens = { inputTokens?: number; outputTokens?: number } | undefined

/**
 * Deja una fila de consumo. **Nunca lanza**: un fallo del registro no puede tumbar la respuesta que
 * el veterinario ya está viendo. Falla abierto y lo deja en el log del servidor, con el mismo
 * criterio que el juez de evidencia y la verificación de citas.
 *
 * Se llama DESPUÉS de que el modelo respondió, así que `elegido.modelId` ya refleja el respaldo si
 * la cascada tuvo que entrar — que es justo lo que hace útil a `fell_back_from`.
 */
export async function registrarUso(entrada: {
  clinicId: string
  userId?: string | null
  surface: SuperficieDeUso
  elegido: ModeloElegido
  usage: UsoDeTokens
}): Promise<void> {
  const { clinicId, userId, surface, elegido, usage } = entrada
  try {
    const cayoAlRespaldo = elegido.modelId !== elegido.modeloPrimario
    await createAdminClient()
      .from("athos_agent_usage")
      .insert({
        clinic_id: clinicId,
        user_id: userId ?? null,
        surface,
        provider: elegido.provider,
        model: elegido.modelId,
        fell_back_from: cayoAlRespaldo ? elegido.modeloPrimario : null,
        // El SDK devuelve `undefined` cuando el proveedor no reporta tokens (algunos streams
        // cortados). Se guarda null antes que un 0 que se sumaría como si no hubiera costado nada.
        tokens_in: usage?.inputTokens ?? null,
        tokens_out: usage?.outputTokens ?? null,
      })
  } catch (e) {
    console.error(`[athos/usage] no se pudo registrar el consumo de ${surface}:`, e)
  }
}

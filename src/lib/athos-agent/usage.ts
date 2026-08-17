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

/**
 * Las superficies de Next que gastan IA. Debe coincidir con el `check` (0046, ampliado por la 0057).
 *
 * `widget` se mide aparte de `agent` a propósito: es la única forma de responder cuánto cuesta que
 * Athos esté presente en toda la app. Mezclarlos hace la pregunta incontestable incluso a posteriori,
 * porque los datos ya quedaron sumados.
 */
export type SuperficieDeUso =
  | "agent"
  | "widget"
  | "suggest_reply"
  | "auto_reply"
  | "cartera_inbound"
  | "vision_recipe"
  | "vision_purchase"
  // El briefing diario: gasto que ocurre SIN que ningun vet lo haya pedido, asi que se mide aparte.
  | "briefing"

/**
 * Lo que devuelve `result.usage` del AI SDK (`LanguageModelUsage`).
 *
 * EL DESGLOSE DE CACHÉ SE LEE DE `inputTokenDetails`, NO de `cachedInputTokens`. Ese último existe
 * y funciona, pero el SDK v6 lo marca **@deprecated** justamente en favor de éste. Usar el campo
 * viejo dejaría un cambio nuevo naciendo con deuda.
 *
 * `inputTokens` es el TOTAL —así lo define el SDK— y el desglose son sus partes, así que las
 * cacheadas ya están adentro y no se suman aparte.
 *
 * Todo opcional porque no todos los proveedores reportan todo: DeepSeek cachea automáticamente y
 * Anthropic sólo cuando se lo pide, así que un `undefined` acá es un estado normal, no un fallo.
 */
type UsoDeTokens =
  | {
      inputTokens?: number
      outputTokens?: number
      inputTokenDetails?: {
        noCacheTokens?: number
        cacheReadTokens?: number
        cacheWriteTokens?: number
      }
    }
  | undefined

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
    // OJO: `.insert()` de supabase-js NO rechaza la promesa ante un error de la base — resuelve con
    // `{ data, error }`. Sin leer `error`, un rechazo de RLS, una violación del check de `surface` o
    // la tabla sin migrar se tragan enteros: el `await` pasa limpio, el catch no se entera y no
    // queda ni una línea de log. Es exactamente el fallo silencioso que este registro existe para
    // eliminar, y lo tenía adentro.
    const { error } = await createAdminClient()
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
        // El desglose de caché. Sin esto no se puede saber si el prefijo se está cacheando, y un
        // ahorro que no se mide es indistinguible de uno que no ocurre. Leer y escribir el caché
        // tienen precios distintos, por eso van separados (ver migración 0065).
        tokens_cache_read: usage?.inputTokenDetails?.cacheReadTokens ?? null,
        tokens_cache_write: usage?.inputTokenDetails?.cacheWriteTokens ?? null,
      })
    if (error) {
      console.error(`[athos/usage] la base rechazó el consumo de ${surface}:`, error.message)
    }
  } catch (e) {
    // Sólo llega acá lo que SÍ lanza: `createAdminClient()` sin variables de entorno, o un fallo de
    // red. Se sigue tragando a propósito — un fallo del registro no puede tumbar una respuesta que
    // el veterinario ya está leyendo.
    console.error(`[athos/usage] no se pudo registrar el consumo de ${surface}:`, e)
  }
}

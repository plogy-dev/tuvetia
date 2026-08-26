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
   * El informe que se le entrega al TITULAR al cerrar la consulta (0071).
   *
   * Se mide aparte y no dentro de `agent` porque contesta una pregunta propia: cuánto cuesta que
   * cada consulta termine con un informe para el dueño. Metida en la bolsa grande, esa cifra no
   * existe — y es justo la que decide si la función se puede regalar o hay que cobrarla.
   */
  | "informe_titular"
  /**
   * Notas y sugerencias MIENTRAS la consulta pasa (Modo Fantasma en vivo).
   *
   * Aparte por la misma razón que `widget`: es la única superficie que se dispara sola, decenas de
   * veces por consulta, sin que nadie apriete nada — o sea la que más hay que poder medir antes de
   * ponerle precio. Sumarla a `agent` haría incontestable esa pregunta incluso a posteriori.
   */
  | "consulta_viva"
  /**
   * Leer con el modelo un PDF ESCANEADO adjuntado al chat (0086). Es la fase 2 de la cascada de
   * adjuntos: la fase 1 (pdfjs en el navegador) es gratis y no pasa por acá — solo se paga cuando
   * el documento no trae texto digital. Se mide aparte porque es la única superficie cuyo costo
   * escala con PÁGINAS de documento y no con turnos de conversación: la cifra que dice si el
   * fallback multimodal se puede regalar o hay que topearlo es exactamente esta.
   */
  | "leer_documento"

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
  /** Cuánto tardó el turno completo, loop de tools incluido (0087). Opcional: no toda superficie
   *  lo mide todavía, y un null honesto vale más que un 0 inventado. */
  duracionMs?: number
}): Promise<void> {
  const { clinicId, userId, surface, elegido, usage, duracionMs } = entrada
  try {
    const cayoAlRespaldo = elegido.modelId !== elegido.modeloPrimario
    // OJO: `.insert()` de supabase-js NO rechaza la promesa ante un error de la base — resuelve con
    // `{ data, error }`. Sin leer `error`, un rechazo de RLS, una violación del check de `surface` o
    // la tabla sin migrar se tragan enteros: el `await` pasa limpio, el catch no se entera y no
    // queda ni una línea de log. Es exactamente el fallo silencioso que este registro existe para
    // eliminar, y lo tenía adentro.
    const fila: Record<string, unknown> = {
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
      // Latencia del turno (0087): la cifra que convierte "Athos tarda un minuto" de anécdota
      // en dato. Redondeada — nadie decide nada con el decimal de un milisegundo.
      duration_ms: duracionMs != null ? Math.round(duracionMs) : null,
    }
    const admin = createAdminClient()
    let { error } = await admin.from("athos_agent_usage").insert(fila)
    if (error && /duration_ms/.test(error.message)) {
      // La 0087 todavía no está aplicada en este entorno: PostgREST rechaza la columna entera y
      // sin este reintento el consumo COMPLETO del turno se perdería (y el tope mensual contaría
      // de menos). Se registra sin la latencia — dato incompleto gana a dato perdido.
      delete fila.duration_ms
      ;({ error } = await admin.from("athos_agent_usage").insert(fila))
    }
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

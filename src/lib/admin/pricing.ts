// Precios unitarios para la estimación de costos del panel admin. EDITABLES: ajustar cuando cambien
// los proveedores. Valores en USD.
//
// HAY DOS CLASES DE COSTO ACÁ, y conviene no confundirlas:
//
//   1. Por TOKENS (`anthropicPorMillon`) — costo REAL, desde `athos_agent_usage` (migración 0046).
//      Es lo único que no es una suposición: el AI SDK devuelve los tokens de cada llamada.
//   2. Por LLAMADA (`llmPorLlamada`, `deepgramPorMinuto`, …) — ESTIMACIÓN. `rag_answer_log` no
//      guarda tokens, así que el gasto de athos-service se aproxima por nº de llamadas × tarifa.
//
// La página los muestra por separado a propósito: mezclarlos daría una cifra que parece exacta y no
// lo es. Pendiente anotado en ESTADO.md: loguear tokens también en `rag_answer_log`.

/**
 * Tarifas por millón de tokens, POR PROVEEDOR.
 *
 * Antes esto era una sola tabla de Anthropic y `costoAnthropic` se le aplicaba a TODAS las filas de
 * `athos_agent_usage`. Eso funcionaba mientras el agente sólo hablaba con Anthropic; desde que la
 * cascada suma DeepSeek y Gemini, cada llamada de un modelo ajeno caía al default de $3/$15 y se
 * cobraba a tarifa Sonnet — del orden de 10× de más para DeepSeek. Y la página rotula esa columna
 * "costo real (tokens medidos)", que es la única línea del panel que dice no ser una estimación.
 *
 * `athos_agent_usage.provider` ya guardaba quién respondió; sólo faltaba mirarlo.
 */
export const TOKENS_POR_MILLON: Record<string, Record<string, { entrada: number; salida: number }>> = {
  // Verificadas 2026-08-01 contra la tabla de modelos.
  // Claude Sonnet 5 tiene precio introductorio de $2/$10 hasta el 2026-08-31. Acá va el precio
  // PLENO a propósito: el panel sobreestima un poco este mes y no se rompe solo en septiembre.
  anthropic: {
    "claude-sonnet-5": { entrada: 3, salida: 15 },
    "claude-haiku-4-5": { entrada: 1, salida: 5 },
    "claude-opus-5": { entrada: 5, salida: 25 },
    "claude-opus-4-8": { entrada: 5, salida: 25 },
  },
  // 👤 PENDIENTE: las tarifas por token de DeepSeek y Gemini. Van vacías A PROPÓSITO.
  //
  // Poner una cifra aproximada acá sería repetir el defecto que este cambio arregla: un número
  // inventado bajo un rótulo que dice "costo real" es peor que un hueco declarado. Mientras estén
  // vacías, el panel muestra esas líneas como "sin tarifa cargada" y las deja fuera del total, que
  // pasa a anunciarse como parcial. Se llenan con la página de precios de cada proveedor.
  deepseek: {},
  google: {},
}

export const PRICING = {
  // Estimación por llamada de generación de athos-service, POR MODELO. Antes era una tarifa única
  // rotulada "DeepSeek" que se le aplicaba a todo `rag_answer_log`, incluidas las respuestas de
  // Gemini o Anthropic — y por eso esos proveedores nunca aparecían en el panel. La columna
  // `rag_answer_log.model` existe y dice quién respondió; ahora se agrupa por ella.
  // (~3-5k tokens de entrada + ~1k de salida por nota o respuesta citada.)
  llmPorLlamada: {
    // Los dos nombres REALES de la API de DeepSeek. `deepseek-v4` a secas no existe —la API
    // responde «The supported API model names are deepseek-v4-pro or deepseek-v4-flash»— y estaba
    // tarifado acá y puesto como default en `athos-agent/model.ts`, así que era una fila que nunca
    // se iba a llenar. Verificado contra la API el 2026-08-01.
    "deepseek-v4-flash": 0.004,
    "deepseek-v4-pro": 0.012,
    "deepseek-chat": 0.004,
    "claude-sonnet-5": 0.024, // 4k in × $3/M + 1k out × $15/M
    "claude-haiku-4-5": 0.009,
    "gemini-2.5-flash": 0.002,
  } as Record<string, number>,
  /** Modelo no listado en `llmPorLlamada`. */
  llmPorLlamadaDefecto: 0.004,

  // Deepgram nova-2 (batch): por minuto de audio transcrito.
  deepgramPerMinute: 0.0043,
  // Cohere embed-v4: embedding de la consulta en el Tier 2 (siempre activo desde la calibración).
  coherePerRetrieval: 0.0006,
  // Cohere rerank-v3.5: está EN PRODUCCIÓN y hasta ahora no se cobraba en ninguna línea — sólo se
  // cobraba el embedding. $2 por 1000 búsquedas de rerank.
  cohereRerankPerRetrieval: 0.002,

  // ── Infra fija mensual ────────────────────────────────────────────────────────────────────────
  //
  // Confirmado por Felipe el 2026-08-01: **el único proveedor de infra que se está pagando hoy es
  // Supabase**. Los otros dos van en 0 porque hoy valen 0, no por descuido — poner una cifra
  // "razonable" donde no hay factura es exactamente el defecto que este archivo vino a arreglar
  // (Kapso se cobraba $29/mes sin que nadie lo usara).
  //
  // Railway: corre el backend de Athos y, desde el 28-jul, también Evolution API en su propio
  // contenedor con un Postgres propio (docs/EVOLUTION.md §Deploy). Hoy no factura, pero son tres
  // servicios persistentes: Evolution mantiene sesiones WebSocket abiertas, así que no se duerme.
  // 👤 En cuanto la primera factura de Railway llegue con un número, va acá.
  railwayMonthly: 0,
  // Vercel: plan Hobby. Es la razón por la que el sweep de cartera vive en GitHub Actions (Hobby
  // permite 2 crons diarios y los dos cupos están usados).
  vercelMonthly: 0,
  // Supabase: el ÚNICO que se paga. El "free tier (→ $25 al migrar el corpus)" que decía antes ya
  // había vencido — el corpus está en el principal desde hace semanas. $25 es el plan Pro base.
  // 👤 Si la factura trae add-ons (cómputo más grande para pgvector, storage, egress), la cifra
  // real es mayor: ajustar acá.
  supabaseMonthly: 25,
} as const

// Kapso: BORRADO. Cobraba $29/mes en cuanto existía CUALQUIER fila en `whatsapp_integrations`,
// sin mirar la columna `provider` (que existe desde la 0028). Hoy la única integración de
// producción es Evolution, así que el cargo era doblemente incorrecto: ni se usa Kapso, ni el
// disparador miraba el proveedor. Si algún día vuelve a haber un tenant en Kapso, el cargo debe
// salir de `whatsapp_integrations.provider = 'kapso'`, no de la mera existencia de una fila.

export const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })

/**
 * Costo real de una tanda de tokens, según quién los cobró.
 *
 * Devuelve `tarifado: false` cuando ese (proveedor, modelo) no tiene tarifa cargada, en vez de
 * caer a la de otro. Quien llama decide qué hacer con eso — la página lo dice en la fila y no lo
 * suma al total. Silenciar el hueco es lo que hacía que el panel mintiera con cara de exactitud.
 */
export function costoTokens(
  provider: string | null,
  model: string,
  tokensIn: number,
  tokensOut: number,
): { usd: number; tarifado: boolean } {
  const t = TOKENS_POR_MILLON[provider ?? ""]?.[model]
  if (!t) return { usd: 0, tarifado: false }
  return {
    usd: (tokensIn / 1_000_000) * t.entrada + (tokensOut / 1_000_000) * t.salida,
    tarifado: true,
  }
}

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

/** Tarifas de Anthropic por millón de tokens. Verificadas 2026-08-01 contra la tabla de modelos. */
export const ANTHROPIC_POR_MILLON: Record<string, { entrada: number; salida: number }> = {
  // Claude Sonnet 5 tiene precio introductorio de $2/$10 hasta el 2026-08-31. Acá va el precio
  // PLENO a propósito: el panel sobreestima un poco este mes y no se rompe solo en septiembre.
  "claude-sonnet-5": { entrada: 3, salida: 15 },
  "claude-haiku-4-5": { entrada: 1, salida: 5 },
  "claude-opus-5": { entrada: 5, salida: 25 },
  "claude-opus-4-8": { entrada: 5, salida: 25 },
}

/** Si un modelo no está en la tabla, se cobra como Sonnet: sobreestimar es mejor que ignorar. */
export const ANTHROPIC_POR_DEFECTO = { entrada: 3, salida: 15 }

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

/** Costo real de una tanda de tokens de Anthropic. */
export function costoAnthropic(model: string, tokensIn: number, tokensOut: number): number {
  const t = ANTHROPIC_POR_MILLON[model] ?? ANTHROPIC_POR_DEFECTO
  return (tokensIn / 1_000_000) * t.entrada + (tokensOut / 1_000_000) * t.salida
}

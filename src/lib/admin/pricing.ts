// Precios unitarios para la estimación de costos del panel admin. EDITABLES: ajustar cuando cambien
// los proveedores. Son ESTIMACIONES — los logs no guardan tokens (mejora anotada en ESTADO.md:
// loguear tokens_in/out en rag_answer_log). Valores en USD.

export const PRICING = {
  // DeepSeek (LLM_PROVIDER=openai, deepseek-chat): estimación por llamada de generación
  // (~3-5k tokens in + ~1k out por nota/respuesta citada a precios de deepseek-chat).
  llmPerCall: 0.004,
  // Haiku (distilación A→B): solo se dispara en huecos de glosario (~9% de consultas), incluido
  // como parte del costo por retrieval de abajo.
  // Deepgram nova-2 (batch): por minuto de audio transcrito.
  deepgramPerMinute: 0.0043,
  // Cohere embed-v4: embedding de la consulta en el Tier 2 (siempre activo desde la calibración).
  coherePerRetrieval: 0.0006,
  // Kapso (WhatsApp): plan base estimado — ajustar cuando se contrate.
  kapsoMonthly: 29,
  // Infra fija mensual.
  railwayMonthly: 5,
  vercelMonthly: 0, // plan free
  supabaseMonthly: 0, // free tier (pasará a $25 al migrar el corpus al principal)
} as const

export const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })

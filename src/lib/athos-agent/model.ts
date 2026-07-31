// Fábrica de modelos del agente Athos — proveedor por env var, nunca hardcodeado (regla del
// CLAUDE.md de athos-service, extendida al front). Permite reaprovechar el API de DeepSeek que ya
// se paga en producción y rutear por rol:
//
//   ATHOS_AGENT_PROVIDER = anthropic | deepseek   (loop multi-tool del agente; default anthropic)
//   ATHOS_AGENT_MODEL    = id del modelo           (default claude-sonnet-5 / deepseek-v4)
//   ATHOS_AUTO_PROVIDER  = anthropic | deepseek   (clasificador/redactor del modo auto; default
//                                                  hereda ATHOS_AGENT_PROVIDER)
//   ATHOS_AUTO_MODEL     = id del modelo           (default claude-haiku-4-5 / deepseek-v4)
//
// Nota honesta: el tool-calling de DeepSeek es menos maduro que el de Anthropic (lo documentó el
// equipo de athos-service). El switch existe para MEDIRLO: probar el loop con deepseek-v4 contra
// el golden set antes de dejarlo fijo. El modo auto (una sola llamada, sin tools) es el candidato
// natural para DeepSeek desde el día uno.

import { anthropic } from "@ai-sdk/anthropic"
import { createDeepSeek } from "@ai-sdk/deepseek"
import type { LanguageModel } from "ai"

import { conCascada, leerCadena } from "@/lib/athos-agent/cascada"

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
})

function resolve(provider: string, model: string): LanguageModel {
  return provider === "deepseek" ? deepseek(model) : anthropic(model)
}

// CASCADA ENTRE PROVEEDORES para el agente (cláusula 1.4), en el mismo formato que athos-service:
//
//   ATHOS_AGENT_CASCADE = "claude-sonnet-5@anthropic,deepseek-v4@deepseek"
//
// Vacía = un solo proveedor, el comportamiento de siempre. Existe porque el 2026-07-31 la cuenta de
// Anthropic se quedó sin crédito y el asistente se cayó ENTERO, mientras el chat clínico —que sí
// tenía cascada— siguió respondiendo con su respaldo. La cascada estaba implementada sólo en el
// servicio de Python; esta superficie había quedado fuera.
export function agentModel(): LanguageModel {
  const provider = process.env.ATHOS_AGENT_PROVIDER ?? "anthropic"
  const model = process.env.ATHOS_AGENT_MODEL ?? (provider === "deepseek" ? "deepseek-v4" : "claude-sonnet-5")

  const cadena = leerCadena(process.env.ATHOS_AGENT_CASCADE)
  if (!cadena.length) return resolve(provider, model)

  return conCascada(
    cadena.map((e) => resolve(e.proveedor, e.modelo)),
    (usado, motivo) =>
      console.warn(`[athos/agent] el primario falló (${motivo}); respondió el respaldo ${usado}`),
  )
}

export function agentModelId(): string {
  const provider = process.env.ATHOS_AGENT_PROVIDER ?? "anthropic"
  return process.env.ATHOS_AGENT_MODEL ?? (provider === "deepseek" ? "deepseek-v4" : "claude-sonnet-5")
}

export function autoModel(): LanguageModel {
  const provider = process.env.ATHOS_AUTO_PROVIDER ?? process.env.ATHOS_AGENT_PROVIDER ?? "anthropic"
  const model = process.env.ATHOS_AUTO_MODEL ?? (provider === "deepseek" ? "deepseek-v4" : "claude-haiku-4-5")
  return resolve(provider, model)
}

export function autoModelId(): string {
  const provider = process.env.ATHOS_AUTO_PROVIDER ?? process.env.ATHOS_AGENT_PROVIDER ?? "anthropic"
  return process.env.ATHOS_AUTO_MODEL ?? (provider === "deepseek" ? "deepseek-v4" : "claude-haiku-4-5")
}

// Visión (extracción de recetas de consumo y facturas de compra desde imagen).
// DeepSeek no expone visión estable por API → siempre Anthropic; Haiku es el default eficiente
// (~12x más barato que Sonnet y sobrado para transcripción estructurada de documentos).
export function visionModel(): LanguageModel {
  return anthropic(visionModelId())
}

export function visionModelId(): string {
  return process.env.ATHOS_VISION_MODEL ?? "claude-haiku-4-5"
}

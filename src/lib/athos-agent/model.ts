// Fábrica de modelos del agente Athos — proveedor por env var, nunca hardcodeado (regla del
// CLAUDE.md de athos-service, extendida al front). Permite reaprovechar el API de DeepSeek que ya
// se paga en producción y rutear por rol:
//
//   ATHOS_AGENT_PROVIDER = anthropic | deepseek   (loop multi-tool del agente; default anthropic)
//   ATHOS_AGENT_MODEL    = id del modelo           (default claude-sonnet-5 / deepseek-v4)
//   ATHOS_AUTO_PROVIDER  = anthropic | deepseek   (clasificador/redactor del modo auto; default
//                                                  hereda ATHOS_AGENT_PROVIDER)
//   ATHOS_AUTO_MODEL     = id del modelo           (default claude-haiku-4-5 / deepseek-v4)
//   ATHOS_VISION_MODEL   = id del modelo           (visión; siempre Anthropic, default claude-haiku-4-5)
//
// Las tres superficies aceptan además una CASCADA (`*_CASCADE`), que tiene prioridad sobre el par
// PROVIDER/MODEL de su superficie — ver más abajo.
//
// Cada fábrica devuelve `{ model, modelId }` JUNTOS, no dos funciones sueltas: con la cascada
// encendida el id tiene que ser el de quien respondió de verdad, y dos funciones independientes se
// desincronizaban.
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

/**
 * Un modelo y el id de QUIÉN respondió, juntos y en el mismo objeto.
 *
 * Antes eran dos funciones sueltas (`agentModel()` y `agentModelId()`) y se desincronizaban: la
 * primera respetaba la cascada y la segunda leía `ATHOS_AGENT_MODEL` por su cuenta. Con la cascada
 * encendida, la fila que se persiste decía que había respondido el primario aunque hubiera
 * contestado el respaldo — y ni siquiera hacía falta un fallo: bastaba con que la cadena empezara
 * por un modelo distinto del default para que reportara el equivocado SIEMPRE. Es el mismo defecto
 * que la Ola 2.1 de la remediación arregló en athos-service (`cascade.usado` en vez de `LLM_MODEL`
 * fijo), repetido acá.
 *
 * `modelId` es MUTABLE a propósito: la cascada lo reescribe al caer al respaldo, y lo hace antes
 * del primer token y de la primera tool call, así que lo que se escriba en la BD ya es correcto.
 * Quien lo consuma debe leerlo TARDE (dentro de la tool, o después de `await`), nunca copiarlo a
 * una constante antes de llamar al modelo.
 */
export type ModeloElegido = {
  model: LanguageModel
  modelId: string
  provider: string
  /** El primero de la cadena. Si al terminar difiere de `modelId`, respondió un respaldo. */
  readonly modeloPrimario: string
}

function conCascadaSiHay(
  superficie: string,
  cadenaEnv: string | undefined,
  fallback: () => Omit<ModeloElegido, "modeloPrimario">,
): ModeloElegido {
  const cadena = leerCadena(cadenaEnv)
  if (!cadena.length) {
    const solo = fallback()
    return { ...solo, modeloPrimario: solo.modelId }
  }

  const elegido: ModeloElegido = {
    model: null as unknown as LanguageModel,
    modelId: cadena[0].modelo,
    provider: cadena[0].proveedor,
    modeloPrimario: cadena[0].modelo,
  }
  elegido.model = conCascada(
    cadena.map((e) => resolve(e.proveedor, e.modelo)),
    (usado, motivo) => {
      elegido.modelId = usado.modelId
      // El proveedor se toma de la CADENA, no del `provider` de la instancia: los SDKs se
      // identifican como "anthropic.messages" / "deepseek.chat", y `provider` tiene que hablar el
      // mismo vocabulario que la env var en las dos ramas (con y sin respaldo) para poder agrupar.
      elegido.provider =
        cadena.find((e) => e.modelo === usado.modelId)?.proveedor ?? usado.provider.split(".")[0]
      console.warn(`[athos/${superficie}] el primario falló (${motivo}); respondió el respaldo ${usado.etiqueta}`)
    },
  )
  return elegido
}

// CASCADA ENTRE PROVEEDORES (cláusula 1.4), en el mismo formato que athos-service:
//
//   ATHOS_AGENT_CASCADE  = "claude-sonnet-5@anthropic,deepseek-v4@deepseek"
//   ATHOS_AUTO_CASCADE   = "claude-haiku-4-5@anthropic,deepseek-v4@deepseek"
//   ATHOS_VISION_CASCADE = "claude-haiku-4-5@anthropic"
//
// Vacías = un solo proveedor, el comportamiento de siempre. Existen porque el 2026-07-31 la cuenta
// de Anthropic se quedó sin crédito y el asistente se cayó ENTERO, mientras el chat clínico —que sí
// tenía cascada— siguió respondiendo con su respaldo. La cascada estaba implementada sólo en el
// servicio de Python; estas tres superficies habían quedado fuera.
export function agentModel(): ModeloElegido {
  return conCascadaSiHay("agent", process.env.ATHOS_AGENT_CASCADE, () => {
    const provider = process.env.ATHOS_AGENT_PROVIDER ?? "anthropic"
    const modelId =
      process.env.ATHOS_AGENT_MODEL ?? (provider === "deepseek" ? "deepseek-v4" : "claude-sonnet-5")
    return { model: resolve(provider, modelId), modelId, provider }
  })
}

// Modo auto de WhatsApp: es el que le contesta al CLIENTE sin vet de por medio, así que una caída
// de proveedor acá se ve desde afuera. Merece cascada tanto como el agente.
export function autoModel(): ModeloElegido {
  return conCascadaSiHay("auto", process.env.ATHOS_AUTO_CASCADE, () => {
    const provider =
      process.env.ATHOS_AUTO_PROVIDER ?? process.env.ATHOS_AGENT_PROVIDER ?? "anthropic"
    const modelId =
      process.env.ATHOS_AUTO_MODEL ?? (provider === "deepseek" ? "deepseek-v4" : "claude-haiku-4-5")
    return { model: resolve(provider, modelId), modelId, provider }
  })
}

// Visión (extracción de recetas de consumo y facturas de compra desde imagen).
// DeepSeek no expone visión estable por API, así que el default sigue siendo Anthropic y punto;
// `ATHOS_VISION_CASCADE` existe para poder poner OTRO modelo de Anthropic como respaldo (o el
// proveedor que llegue a tener visión) sin tocar código.
export function visionModel(): ModeloElegido {
  return conCascadaSiHay("vision", process.env.ATHOS_VISION_CASCADE, () => {
    const modelId = process.env.ATHOS_VISION_MODEL ?? "claude-haiku-4-5"
    return { model: anthropic(modelId), modelId, provider: "anthropic" }
  })
}

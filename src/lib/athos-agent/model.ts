// Fábrica de modelos del agente Athos — proveedor por env var, nunca hardcodeado (regla del
// CLAUDE.md de athos-service, extendida al front). Permite reaprovechar el API de DeepSeek que ya
// se paga en producción y rutear por rol:
//
//   ATHOS_AGENT_PROVIDER = anthropic | deepseek   (loop multi-tool del agente; default anthropic)
//   ATHOS_AGENT_MODEL    = id del modelo           (default claude-sonnet-5 / deepseek-v4-flash)
//   ATHOS_AUTO_PROVIDER  = anthropic | deepseek   (clasificador/redactor del modo auto; default
//                                                  hereda ATHOS_AGENT_PROVIDER)
//   ATHOS_AUTO_MODEL     = id del modelo           (default claude-haiku-4-5 / deepseek-v4-flash)
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
// equipo de athos-service). El switch existe para MEDIRLO: probar el loop con deepseek-v4-pro contra
// el golden set antes de dejarlo fijo. El modo auto (una sola llamada, sin tools) es el candidato
// natural para DeepSeek desde el día uno.

import { anthropic } from "@ai-sdk/anthropic"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { LanguageModel } from "ai"

import { conCascada, leerCadena } from "@/lib/athos-agent/cascada"

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
})

// Gemini. La variable se llama GEMINI_API_KEY —no GOOGLE_*— para usar el MISMO nombre que
// athos-service en Railway: es la misma cuenta y quien opera no debería tener que recordar dos
// nombres para la misma credencial. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` son de OAuth de
// Calendar y no tienen nada que ver.
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY ?? "",
  ...(process.env.GEMINI_BASE_URL ? { baseURL: process.env.GEMINI_BASE_URL } : {}),
})

// Los únicos proveedores con SDK cableado. Existe como lista explícita —y no como el `else` de un
// ternario— porque sin ella un typo era invisible y peligroso: `@deepsek` caía al else y resolvía
// contra Anthropic, así que la "cascada" terminaba siendo dos llamadas al MISMO proveedor sin
// crédito. La Ola 2.2 del plan de remediación arregló exactamente esto en `provider_cascade.py`
// (`PROVEEDORES_VALIDOS`); el port a TypeScript lo había reintroducido.
//
// Las claves son las MISMAS que `PROVEEDORES_VALIDOS` de athos-service: el proveedor de Gemini se
// llama `google`, no `gemini` — así una cadena escrita para el backend vale igual acá. (`openai`
// existe allá y no acá: nadie lo usa en esta superficie.)
//
// ⚠️ CUIDADO AL ACTUALIZAR `@ai-sdk/google`: está fijado en 3.x a propósito. La 4.x habla la
// especificación **v4** y la cascada exige v3 (lo mismo que anthropic y deepseek), así que un
// modelo v4 se descarta como respaldo inválido — con aviso en el log, pero SIN cascada. Se detectó
// al instalarlo: `npm i @ai-sdk/google` trae la 4.x y Gemini quedaba fuera en silencio.
const PROVEEDORES = {
  anthropic: (model: string) => anthropic(model),
  deepseek: (model: string) => deepseek(model),
  google: (model: string) => google(model),
} as const

export type Proveedor = keyof typeof PROVEEDORES

export function esProveedorValido(nombre: string): nombre is Proveedor {
  return nombre in PROVEEDORES
}

function resolve(provider: string, model: string): LanguageModel {
  return esProveedorValido(provider) ? PROVEEDORES[provider](model) : anthropic(model)
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
  // Se descartan los eslabones con proveedor desconocido ANTES de armar nada. Un typo así no puede
  // degradar en silencio a "todo va a Anthropic": es justo el escenario en el que la cascada parece
  // encendida y no protege de nada.
  const cadena = leerCadena(cadenaEnv).filter((e) => {
    if (esProveedorValido(e.proveedor)) return true
    console.warn(
      `[athos/${superficie}] proveedor desconocido "${e.proveedor}" en la cascada:` +
        ` se descarta "${e.modelo}@${e.proveedor}". Válidos: ${Object.keys(PROVEEDORES).join(", ")}`,
    )
    return false
  })

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
//   ATHOS_AGENT_CASCADE  = "deepseek-v4-flash@deepseek,gemini-3.6-flash@google,claude-sonnet-5@anthropic"
//   ATHOS_AUTO_CASCADE   = "deepseek-v4-flash@deepseek,gemini-3.6-flash@google,claude-haiku-4-5@anthropic"
//   ATHOS_VISION_CASCADE = "gemini-3.6-flash@google,claude-haiku-4-5@anthropic"
//
// ⚠️ LA LÍNEA DE VISIÓN DECÍA LO CONTRARIO —Anthropic primero— tres renglones antes de la regla de
// abajo que lo prohíbe, y producción la copió tal cual. Verificado el 26-ago en
// `athos_agent_usage`: la superficie `leer_documento` registra `provider=google` con
// `fell_back_from=claude-haiku-4-5`. O sea que CADA documento que un vet adjunta al chat gasta
// primero un intento fallido contra Anthropic —y como no se fija `maxRetries`, el SDK reintenta:
// hasta tres llamadas muertas con su backoff— antes de que Gemini conteste. Con un PDF escaneado
// pesado eso puede comerse el `maxDuration = 60` de la ruta, y entonces no es lentitud: es el
// adjunto fallando. Es el reporte del cliente del 26-ago, «está fallando colgar archivos».
//
// Corregir el ejemplo no arregla producción: hay que INVERTIR `ATHOS_VISION_CASCADE` en Vercel.
// Las otras dos superficies ya están bien (`agent` y `briefing` registran DeepSeek sin respaldo).
//
// Los TRES proveedores, igual que la cascada de athos-service (cláusula 1.4). Gemini se sumó el
// 2026-08-02: hasta entonces esta superficie tenía dos y el backend tres, así que una caída
// simultánea de DeepSeek y Anthropic tumbaba el agente mientras el chat clínico seguía en pie.
//
// Visión es el caso especial: DeepSeek no expone visión estable, pero Gemini SÍ, así que ahí el
// respaldo es Gemini y no un segundo modelo de Anthropic.
//
// ⚠️ EL ORDEN NO ES COSMÉTICO. `provider_cascade.py` lo dice en su docstring: «Anthropic NO debe ir
// primero mientras su cuenta no tenga crédito: cada intento suyo agregaría una llamada fallida y su
// latencia antes de llegar al proveedor que sí puede responder». Los ejemplos de arriba ponen
// DeepSeek primero por eso. **Cuando Anthropic vuelva a tener saldo conviene invertirlos**: su
// tool-calling es más maduro y el agente usa 17 herramientas.
//
// Vacías = un solo proveedor, el comportamiento de siempre. Existen porque el 2026-07-31 la cuenta
// de Anthropic se quedó sin crédito y el asistente se cayó ENTERO, mientras el chat clínico —que sí
// tenía cascada— siguió respondiendo con su respaldo. La cascada estaba implementada sólo en el
// servicio de Python; estas tres superficies habían quedado fuera.
export function agentModel(): ModeloElegido {
  return conCascadaSiHay("agent", process.env.ATHOS_AGENT_CASCADE, () => {
    const provider = process.env.ATHOS_AGENT_PROVIDER ?? "anthropic"
    const modelId =
      process.env.ATHOS_AGENT_MODEL ?? (provider === "deepseek" ? "deepseek-v4-flash" : "claude-sonnet-5")
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
      process.env.ATHOS_AUTO_MODEL ?? (provider === "deepseek" ? "deepseek-v4-flash" : "claude-haiku-4-5")
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

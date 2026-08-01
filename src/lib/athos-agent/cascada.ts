// Cascada entre proveedores para el AGENTE (Next/Vercel).
//
// Por qué existe. La cascada de la cláusula 1.4 estaba implementada sólo en `athos-service`
// (`app/generation/provider_cascade.py`, Python/Railway). El agente vive en Next y resolvía UN solo
// proveedor sin alternativa: el 2026-07-31 la cuenta de Anthropic se quedó sin crédito y el
// asistente se cayó entero, mientras el chat clínico —que sí tiene cascada— siguió respondiendo.
// Esta es la misma idea portada a TypeScript.
//
// LA REGLA QUE NO SE NEGOCIA: se cae al respaldo **antes del primer token**, nunca a mitad de
// respuesta. Coser dos modelos dejaría media respuesta de uno y media de otro, que en una nota
// clínica es peor que un error. Se consigue enganchando `doStream()`: ese promise se resuelve
// cuando el proveedor ACEPTA la petición, así que si rechaza (sin saldo, credencial inválida,
// cuota) el fallo llega antes de que salga un solo token.
import { wrapLanguageModel, type LanguageModel } from "ai"
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

/**
 * ¿Es un fallo DEL PROVEEDOR, y por lo tanto tiene sentido reintentar con otro?
 *
 * Un error de nuestro código (un tool mal definido, un prompt inválido) fallaría igual en el
 * segundo proveedor: reintentarlo sólo gasta dinero y tiempo. Se pasa al respaldo únicamente
 * cuando el problema es de la cuenta o del servicio.
 */
export function esFalloDeProveedor(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase()
  return (
    // saldo o cuota agotados — el caso del 2026-07-31
    msg.includes("credit") ||
    msg.includes("billing") ||
    msg.includes("quota") ||
    msg.includes("insufficient") ||
    // credencial ausente o inválida
    msg.includes("api key") ||
    msg.includes("apikey") ||
    msg.includes("authentication") ||
    msg.includes("401") ||
    msg.includes("403") ||
    // el proveedor está limitando o caído.
    //
    // "rate limit" completo, NUNCA "rate" a secas: `"generated".includes("rate")` es true
    // (gene-RATE-d), así que un `AI_NoObjectGeneratedError` —o cualquier error nuestro que hable de
    // "generate"— disparaba el respaldo y pagaba una segunda llamada entera por un bug propio, que
    // es justo lo que esta función existe para evitar. Las tres grafías cubren a los proveedores:
    // Anthropic manda `rate_limit_error`, OpenAI/DeepSeek "Rate limit reached".
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("ratelimit") ||
    msg.includes("429") ||
    msg.includes("overloaded") ||
    msg.includes("503") ||
    msg.includes("502") ||
    // la red no llegó
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  )
}

/**
 * Quién respondió cuando entra un respaldo.
 *
 * Viene desglosado a propósito: `etiqueta` es para el log de la consola, pero `modelId` es lo que se
 * PERSISTE (`athos_actions.proposed_by_model`, la traza del agente). Si el que responde de verdad no
 * es el que queda escrito en la fila, la traza miente — que es el defecto que la Ola 2.1 del plan de
 * remediación arregló en athos-service y que esta superficie había repetido.
 */
export type RespaldoUsado = { modelId: string; provider: string; etiqueta: string }

function describir(m: LanguageModel): RespaldoUsado {
  if (typeof m === "string") return { modelId: m, provider: "?", etiqueta: m }
  const v = m as Partial<LanguageModelV3>
  const modelId = v.modelId ?? "?"
  const provider = v.provider ?? "?"
  return { modelId, provider, etiqueta: `${provider}:${modelId}` }
}

/**
 * Envuelve el primer modelo de `cadena` para que caiga a los siguientes si el proveedor falla.
 *
 * Con un solo elemento devuelve el modelo tal cual: la cascada es ADITIVA, apagarla deja el
 * comportamiento exactamente como estaba.
 */
export function conCascada(
  cadena: LanguageModel[],
  alUsarRespaldo?: (usado: RespaldoUsado, motivo: string) => void,
): LanguageModel {
  const [principal, ...respaldos] = cadena
  if (!principal) throw new Error("conCascada: la cadena de modelos está vacía")
  if (!respaldos.length) return principal

  async function intentarRespaldos(
    params: LanguageModelV3CallOptions,
    operacion: "stream" | "generate",
    errorOriginal: unknown,
  ) {
    for (const respaldo of respaldos) {
      try {
        const m = respaldo as LanguageModelV3
        const salida = operacion === "stream" ? await m.doStream(params) : await m.doGenerate(params)
        // Se avisa DESPUÉS de que el respaldo aceptó la petición y ANTES de devolver la salida:
        // o sea, antes del primer token y antes de la primera tool call. Quien escucha alcanza a
        // corregir el modelo que va a persistir.
        alUsarRespaldo?.(
          describir(respaldo),
          errorOriginal instanceof Error ? errorOriginal.message : String(errorOriginal),
        )
        return salida
      } catch (e) {
        // Si el respaldo falla por OTRA razón, ese error importa más que el original.
        if (!esFalloDeProveedor(e)) throw e
      }
    }
    // Ninguno respondió: se propaga el error del PRIMARIO, que es el que el equipo espera ver.
    throw errorOriginal
  }

  // `LanguageModel` admite el atajo de string ("anthropic/claude-…"), que no expone `doStream`, y
  // también modelos de la especificación v2. La cascada necesita una instancia v3: si llega otra
  // cosa se devuelve tal cual. Degradar al comportamiento anterior es preferible a fallar al
  // arrancar por una envoltura que es una MEJORA, no un requisito.
  if (typeof principal === "string" || principal.specificationVersion !== "v3") return principal

  return wrapLanguageModel({
    model: principal as LanguageModelV3,
    middleware: {
      specificationVersion: "v3",
      wrapStream: async ({ doStream, params }) => {
        try {
          return await doStream()
        } catch (e) {
          if (!esFalloDeProveedor(e)) throw e
          return (await intentarRespaldos(params, "stream", e)) as Awaited<ReturnType<typeof doStream>>
        }
      },
      wrapGenerate: async ({ doGenerate, params }) => {
        try {
          return await doGenerate()
        } catch (e) {
          if (!esFalloDeProveedor(e)) throw e
          return (await intentarRespaldos(params, "generate", e)) as Awaited<
            ReturnType<typeof doGenerate>
          >
        }
      },
    },
  })
}

/**
 * Lee la cadena de una variable de entorno con el MISMO formato que usa athos-service:
 * `"modelo@proveedor,modelo@proveedor"`, en orden de preferencia.
 *
 * Vacía = sin cascada, que es el comportamiento de siempre.
 */
export function leerCadena(valor: string | undefined): { modelo: string; proveedor: string }[] {
  return (valor ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((par) => {
      const [modelo, proveedor] = par.split("@").map((s) => s.trim())
      return { modelo, proveedor: proveedor || "anthropic" }
    })
    .filter((x) => Boolean(x.modelo))
}

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
// clínica es peor que un error.
//
// Eso se consigue con DOS mecanismos, no con uno:
//
//  1. Enganchar `doStream()`: ese promise se resuelve cuando el proveedor ACEPTA la petición, así
//     que un rechazo (saldo, credencial, cuota) llega antes de que salga un solo token.
//  2. FIJAR el proveedor para el resto de la respuesta. El agente corre un bucle de herramientas de
//     hasta 8 pasos (`stopWhen: stepCountIs(8)` en `agent/route.ts`) y el SDK llama a `doStream()`
//     una vez POR PASO. Sin (2), agotarse el saldo en el paso 3 dejaba los pasos 1-2 escritos por
//     Claude y los 3-8 por DeepSeek: una sola respuesta clínica cosida de dos modelos, que es
//     exactamente lo que este módulo dice que no debe pasar. `indice` vive en el closure y la
//     fábrica se llama una vez por petición, así que el alcance es la respuesta.
import { wrapLanguageModel, type LanguageModel } from "ai"
import { APICallError, type LanguageModelV3, type LanguageModelV3CallOptions } from "@ai-sdk/provider"

/**
 * De quién es la culpa. Es la ÚNICA fuente de verdad de esta clasificación: `agent/route.ts` la
 * importa para elegir el mensaje que ve el veterinario, en vez de mantener su propia lista de
 * subcadenas. Tenerla dos veces ya salió mal una vez — el arreglo de "rate limit" entró en este
 * archivo y la copia de la ruta se quedó vieja.
 */
export type ClaseDeFallo = "saldo" | "credencial" | "limite" | "servicio" | "red" | "nuestro"

/** `\b401\b` y no `includes("401")`: un id o un timestamp que contenga 401 no es un 401. */
function tieneCodigo(texto: string, codigo: number): boolean {
  return new RegExp(`\\b${codigo}\\b`).test(texto)
}

/**
 * Clasifica un fallo mirando el ESTADO HTTP y el cuerpo de la respuesta, no sólo el mensaje.
 *
 * Por qué importa: el AI SDK construye `APICallError` con `message: errorToMessage(parsedError)`,
 * que es el mensaje del proveedor PELADO, sin el código de estado. El 401 de una clave revocada
 * llega como `invalid x-api-key` — que no contiene "api key" (lleva guiones), ni "401", ni
 * "authentication" (eso es el *tipo*, no el mensaje). Clasificar sólo por subcadenas del mensaje
 * dejaba fuera el caso más probable del día de la rotación de credenciales.
 */
export function clasificarFallo(error: unknown): ClaseDeFallo {
  const msg = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase()
  const api = APICallError.isInstance(error) ? error : null
  const cuerpo = (api?.responseBody ?? "").toLowerCase()
  const texto = `${msg} ${cuerpo}`
  const estado = api?.statusCode

  // SALDO PRIMERO, y a propósito: Anthropic devuelve el crédito agotado como **400**, no como 402
  // ni 429. Si se clasificara por estado antes que por contenido, el caso del 2026-07-31 —el que
  // originó todo este módulo— caería en "nuestro" y no dispararía el respaldo.
  if (
    texto.includes("credit") ||
    texto.includes("billing") ||
    texto.includes("quota") ||
    texto.includes("insufficient") ||
    texto.includes("payment") ||
    texto.includes("balance is too low")
  ) {
    return "saldo"
  }

  if (
    estado === 401 ||
    estado === 403 ||
    texto.includes("authentication_error") ||
    texto.includes("permission_error") ||
    texto.includes("invalid_api_key") ||
    texto.includes("api key") ||
    texto.includes("api-key") ||
    texto.includes("apikey") ||
    texto.includes("unauthorized") ||
    texto.includes("forbidden") ||
    (!estado && (tieneCodigo(msg, 401) || tieneCodigo(msg, 403)))
  ) {
    return "credencial"
  }

  // "rate limit" completo, NUNCA "rate" a secas: `"generated".includes("rate")` es true (gene-RATE-d),
  // así que un `AI_NoObjectGeneratedError` —o cualquier error nuestro que hable de "generate"—
  // disparaba el respaldo y pagaba una segunda llamada entera por un bug propio.
  if (
    estado === 429 ||
    texto.includes("rate limit") ||
    texto.includes("rate_limit") ||
    texto.includes("ratelimit") ||
    texto.includes("too many requests") ||
    (!estado && tieneCodigo(msg, 429))
  ) {
    return "limite"
  }

  if (
    (estado !== undefined && estado >= 500) ||
    texto.includes("overloaded") ||
    texto.includes("service unavailable") ||
    texto.includes("bad gateway") ||
    texto.includes("internal server error") ||
    (!estado && (tieneCodigo(msg, 500) || tieneCodigo(msg, 502) || tieneCodigo(msg, 503)))
  ) {
    return "servicio"
  }

  if (
    texto.includes("timeout") ||
    texto.includes("etimedout") ||
    texto.includes("econnreset") ||
    texto.includes("econnrefused") ||
    texto.includes("enotfound") ||
    texto.includes("socket hang up") ||
    texto.includes("fetch failed") ||
    texto.includes("network error")
  ) {
    return "red"
  }

  return "nuestro"
}

/**
 * ¿Es un fallo DEL PROVEEDOR, y por lo tanto tiene sentido reintentar con otro?
 *
 * Un error de nuestro código (un tool mal definido, un prompt inválido) fallaría igual en el
 * segundo proveedor: reintentarlo sólo gasta dinero y tiempo.
 */
export function esFalloDeProveedor(error: unknown): boolean {
  return clasificarFallo(error) !== "nuestro"
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

/** `LanguageModel` admite el atajo de string y modelos v2, que no exponen `doStream`. */
function esV3(m: LanguageModel): m is LanguageModelV3 {
  return typeof m !== "string" && (m as Partial<LanguageModelV3>).specificationVersion === "v3"
}

/**
 * Marca el error para que el SDK no reintente.
 *
 * `wrapLanguageModel` devuelve el modelo que el `retry` de `streamText` ENVUELVE, o sea que los
 * reintentos quedan por FUERA de la cascada. Sin esto, una caída total reproducía la cadena entera
 * hasta tres veces con backoff: en una demo son decenas de segundos de pantalla muerta antes del
 * mensaje de error. Si la cadena completa ya falló, reintentarla no va a cambiar el resultado.
 */
function noReintentable(error: unknown): unknown {
  if (!APICallError.isInstance(error) || !error.isRetryable) return error
  return new APICallError({
    message: error.message,
    url: error.url,
    requestBodyValues: error.requestBodyValues,
    statusCode: error.statusCode,
    responseHeaders: error.responseHeaders,
    responseBody: error.responseBody,
    cause: error,
    isRetryable: false,
    data: error.data,
  })
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
  const [principal, ...resto] = cadena
  if (!principal) throw new Error("conCascada: la cadena de modelos está vacía")

  // Los respaldos se validan AQUÍ, no al usarlos. Antes se casteaban con `as LanguageModelV3` y un
  // string o un modelo v2 explotaba con `m.doStream is not a function` — un TypeError que no es
  // fallo de proveedor y que se propagaba tapando el error real del primario.
  const respaldos = resto.filter((m): m is LanguageModelV3 => {
    if (esV3(m)) return true
    console.warn(`[cascada] respaldo descartado, no es un modelo v3: ${describir(m).etiqueta}`)
    return false
  })

  if (!respaldos.length || !esV3(principal)) return principal

  // El eslabón que está respondiendo esta petición. 0 = primario. Se mantiene entre pasos del bucle
  // de herramientas: una vez que respondió un respaldo, la respuesta entera sale de él.
  let indice = 0

  async function ejecutar(
    params: LanguageModelV3CallOptions,
    operacion: "stream" | "generate",
    // `PromiseLike` y no `Promise`: es lo que devuelve el `doStream` que entrega el middleware.
    llamarPrincipal: () => PromiseLike<unknown>,
  ): Promise<unknown> {
    let primerError: unknown = null

    for (let i = indice; i <= respaldos.length; i++) {
      const esPrimario = i === 0
      try {
        const salida = esPrimario
          ? await llamarPrincipal()
          : operacion === "stream"
            ? await respaldos[i - 1].doStream(params)
            : await respaldos[i - 1].doGenerate(params)

        // Se avisa DESPUÉS de que el respaldo aceptó la petición y ANTES de devolver la salida: o
        // sea, antes del primer token y antes de la primera tool call. Quien escucha alcanza a
        // corregir el modelo que va a persistir.
        if (!esPrimario && i !== indice) {
          alUsarRespaldo?.(
            describir(respaldos[i - 1]),
            primerError instanceof Error ? primerError.message : String(primerError),
          )
        }
        indice = i
        return salida
      } catch (e) {
        if (primerError === null) primerError = e

        // Un fallo NUESTRO en el primario fallaría igual en el resto: se propaga sin gastar otra
        // llamada. En un RESPALDO, en cambio, se sigue: el motivo suele ser de forma (una parte de
        // contenido que ese proveedor no acepta) y el siguiente eslabón sí puede responder.
        if (esPrimario && !esFalloDeProveedor(e)) throw e

        console.warn(
          `[cascada] ${describir(esPrimario ? principal : respaldos[i - 1]).etiqueta} falló` +
            ` (${clasificarFallo(e)}): ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }

    // Ninguno respondió: se propaga el error del PRIMARIO, que es el que el equipo espera ver, ya
    // marcado para que el SDK no reproduzca la cadena entera otras dos veces.
    throw noReintentable(primerError)
  }

  return wrapLanguageModel({
    model: principal,
    middleware: {
      specificationVersion: "v3",
      wrapStream: async ({ doStream, params }) =>
        (await ejecutar(params, "stream", doStream)) as Awaited<ReturnType<typeof doStream>>,
      wrapGenerate: async ({ doGenerate, params }) =>
        (await ejecutar(params, "generate", doGenerate)) as Awaited<ReturnType<typeof doGenerate>>,
    },
  })
}

/**
 * Lee la cadena de una variable de entorno con el MISMO formato que usa athos-service:
 * `"modelo@proveedor,modelo@proveedor"`, en orden de preferencia.
 *
 * Vacía = sin cascada, que es el comportamiento de siempre. El proveedor NO se valida acá: lo hace
 * `model.ts`, que es quien sabe qué SDKs hay cableados.
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

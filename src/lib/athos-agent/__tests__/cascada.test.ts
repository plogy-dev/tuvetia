// La cascada entre proveedores del agente.
//
// Existe por un incidente real: el 2026-07-31 la cuenta de Anthropic se quedó sin crédito y el
// asistente se cayó entero, mientras el chat clínico —que sí tenía cascada— siguió respondiendo.
// La cascada estaba implementada sólo en athos-service (Python); esta superficie había quedado fuera.
//
// OJO CON LAS PRUEBAS DE ESTE ARCHIVO: la primera versión pasaba en verde escribiendo a mano
// mensajes como "401 Unauthorized" que el AI SDK NUNCA produce. Los casos de abajo usan
// `APICallError` con el estado y el cuerpo REALES de cada proveedor. Una prueba que inventa su
// propia entrada no prueba nada.
import { describe, expect, it, vi } from "vitest"
import type { LanguageModel } from "ai"
import { APICallError, type LanguageModelV3, type LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { clasificarFallo, conCascada, esFalloDeProveedor, leerCadena } from "@/lib/athos-agent/cascada"

/** Modelo falso: responde, o falla con lo que se le indique. */
function modeloFalso(id: string, fallaCon?: unknown): LanguageModelV3 {
  const salida = { stream: `stream-de-${id}`, request: {}, response: {} }
  const gen = { content: [{ type: "text", text: `texto-de-${id}` }], finishReason: "stop" }
  const reventar = () => {
    if (fallaCon !== undefined) throw fallaCon instanceof Error ? fallaCon : new Error(String(fallaCon))
  }
  return {
    specificationVersion: "v3",
    provider: "falso",
    modelId: id,
    supportedUrls: {},
    doStream: vi.fn(async () => {
      reventar()
      return salida
    }),
    doGenerate: vi.fn(async () => {
      reventar()
      return gen
    }),
  } as unknown as LanguageModelV3
}

/** El error tal como lo construye el AI SDK: mensaje PELADO del proveedor + estado + cuerpo. */
function errorDeApi(mensaje: string, statusCode?: number, responseBody?: string) {
  return new APICallError({
    message: mensaje,
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode,
    responseBody,
    isRetryable: statusCode === 429 || (statusCode ?? 0) >= 500,
  })
}

const PARAMS = { prompt: [] } as unknown as LanguageModelV3CallOptions
const stream = (m: LanguageModel) => (m as LanguageModelV3).doStream(PARAMS)
const espia = (m: LanguageModelV3) => (m as unknown as { doStream: ReturnType<typeof vi.fn> }).doStream

describe("clasificarFallo — contra los errores REALES de los proveedores", () => {
  it("saldo agotado: Anthropic lo manda como 400, no como 402", () => {
    // El caso exacto del 2026-07-31. Si se clasificara por estado antes que por contenido, un 400
    // caería en "nuestro" y la cascada no se dispararía.
    const e = errorDeApi(
      "Your credit balance is too low to access the Anthropic API",
      400,
      '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}',
    )
    expect(clasificarFallo(e)).toBe("saldo")
  })

  it("clave revocada: el mensaje es `invalid x-api-key` y no contiene «api key» ni «401»", () => {
    // Éste es el que la versión anterior NO detectaba, y es el escenario de la rotación de
    // credenciales: sin el estado HTTP, ninguna subcadena del mensaje matchea.
    const e = errorDeApi(
      "invalid x-api-key",
      401,
      '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    )
    expect(clasificarFallo(e)).toBe("credencial")
    expect(esFalloDeProveedor(e)).toBe(true)
  })

  it.each([
    ["límite de tasa", errorDeApi("rate_limit_error", 429), "limite"],
    ["proveedor caído", errorDeApi("Internal server error", 500), "servicio"],
    ["sobrecargado", errorDeApi("Overloaded", 529), "servicio"],
    ["permiso denegado", errorDeApi("Request not allowed", 403), "credencial"],
  ] as const)("%s", (_, e, esperado) => {
    expect(clasificarFallo(e)).toBe(esperado)
  })

  it("la red que no llegó no lleva estado HTTP", () => {
    expect(clasificarFallo(new TypeError("fetch failed"))).toBe("red")
    expect(clasificarFallo(new Error("ETIMEDOUT"))).toBe("red")
  })

  it.each([
    "Invalid tool definition: missing inputSchema",
    "El paciente no existe",
    "Cannot read properties of undefined",
    // El que motivó el arreglo de Felipe: "generated" contiene "rate".
    "AI_NoObjectGeneratedError: No object generated",
  ])("NO es del proveedor: %s", (msg) => {
    expect(clasificarFallo(new Error(msg))).toBe("nuestro")
    expect(esFalloDeProveedor(new Error(msg))).toBe(false)
  })

  it("un 401 dentro de un identificador no es un 401", () => {
    // `includes("401")` daba true con `req_014019...`. Con `\b401\b` ya no.
    expect(clasificarFallo(new Error("request req_01401993 failed to parse"))).toBe("nuestro")
  })
})

describe("conCascada", () => {
  it("con un solo modelo devuelve el modelo tal cual (la cascada es aditiva)", () => {
    const m = modeloFalso("solo")
    expect(conCascada([m])).toBe(m)
  })

  it("si el primario responde, el respaldo NI SE TOCA", async () => {
    const a = modeloFalso("principal")
    const b = modeloFalso("respaldo")
    const r = await stream(conCascada([a, b]))
    expect((r as unknown as { stream: string }).stream).toBe("stream-de-principal")
    expect(espia(b)).not.toHaveBeenCalled()
  })

  it("SIN SALDO en el primario, responde el respaldo", async () => {
    const a = modeloFalso("anthropic", errorDeApi("Your credit balance is too low", 400))
    const b = modeloFalso("deepseek")
    const avisos: string[] = []
    const r = await stream(conCascada([a, b], (usado) => avisos.push(usado.etiqueta)))
    expect((r as unknown as { stream: string }).stream).toBe("stream-de-deepseek")
    expect(avisos).toEqual(["falso:deepseek"])
  })

  it("avisa el modelId REAL, que es el que se persiste en la traza", async () => {
    const usados: { modelId: string; provider: string }[] = []
    await stream(
      conCascada([modeloFalso("claude-sonnet-5", errorDeApi("credit", 400)), modeloFalso("deepseek-v4")], (u) =>
        usados.push({ modelId: u.modelId, provider: u.provider }),
      ),
    )
    expect(usados).toEqual([{ modelId: "deepseek-v4", provider: "falso" }])
  })

  it("un error NUESTRO en el primario no dispara la cascada", async () => {
    const b = modeloFalso("respaldo")
    const casc = conCascada([modeloFalso("a", new Error("Invalid tool definition")), b])
    await expect(stream(casc)).rejects.toThrow("Invalid tool definition")
    expect(espia(b)).not.toHaveBeenCalled()
  })

  it("un error NO-proveedor en un RESPALDO no aborta la cadena: sigue con el siguiente", async () => {
    // Antes hacía `throw e`, que escapaba del for entero y dejaba sin intentar un eslabón que sí
    // podía responder.
    const tercero = modeloFalso("tres")
    const r = await stream(
      conCascada([
        modeloFalso("uno", errorDeApi("credit balance too low", 400)),
        modeloFalso("dos", new Error("unsupported content part")),
        tercero,
      ]),
    )
    expect((r as unknown as { stream: string }).stream).toBe("stream-de-tres")
    expect(espia(tercero)).toHaveBeenCalled()
  })

  it("si NINGUNO responde, se propaga el error del PRIMARIO", async () => {
    const casc = conCascada([
      modeloFalso("a", errorDeApi("credit balance too low", 400)),
      modeloFalso("b", errorDeApi("rate_limit_error", 429)),
    ])
    await expect(stream(casc)).rejects.toThrow("credit balance too low")
  })

  it("y ese error queda marcado NO reintentable, para que el SDK no repita la cadena entera", async () => {
    // `wrapLanguageModel` va por DENTRO del retry de streamText: sin esto, una caída total
    // reproducía los N proveedores tres veces con backoff.
    const casc = conCascada([
      modeloFalso("a", errorDeApi("Overloaded", 529)),
      modeloFalso("b", errorDeApi("rate_limit_error", 429)),
    ])
    const e = await Promise.resolve(stream(casc)).catch((x: unknown) => x)
    expect(APICallError.isInstance(e)).toBe(true)
    expect((e as APICallError).isRetryable).toBe(false)
  })

  describe("el proveedor queda FIJADO para el resto de la respuesta", () => {
    it("una vez que responde el respaldo, los pasos siguientes NO vuelven al primario", async () => {
      // El agente corre hasta 8 pasos y el SDK llama a doStream una vez por paso. Sin fijar, un
      // saldo que se agota a mitad dejaba media nota clínica de cada modelo.
      const principal = modeloFalso("claude", errorDeApi("credit balance too low", 400))
      const respaldo = modeloFalso("deepseek")
      const casc = conCascada([principal, respaldo])

      for (let paso = 0; paso < 4; paso++) {
        const r = await stream(casc)
        expect((r as unknown as { stream: string }).stream).toBe("stream-de-deepseek")
      }

      // El primario se intentó UNA sola vez, en el paso 1. Los otros tres fueron directo al respaldo.
      expect(espia(principal)).toHaveBeenCalledTimes(1)
      expect(espia(respaldo)).toHaveBeenCalledTimes(4)
    })

    it("y sólo se avisa del cambio una vez, no en cada paso", async () => {
      const avisos: string[] = []
      const casc = conCascada(
        [modeloFalso("claude", errorDeApi("credit", 400)), modeloFalso("deepseek")],
        (u) => avisos.push(u.etiqueta),
      )
      await stream(casc)
      await stream(casc)
      await stream(casc)
      expect(avisos).toHaveLength(1)
    })
  })

  it("un respaldo que no es v3 se descarta al armar, no explota al usarlo", async () => {
    // Antes se casteaba con `as LanguageModelV3` y reventaba con "m.doStream is not a function",
    // un TypeError que tapaba el error real del primario.
    const bueno = modeloFalso("bueno")
    const casc = conCascada([
      modeloFalso("malo", errorDeApi("credit", 400)),
      "anthropic/claude-sonnet-5" as unknown as LanguageModel,
      bueno,
    ])
    const r = await stream(casc)
    expect((r as unknown as { stream: string }).stream).toBe("stream-de-bueno")
  })

  it("también cubre el camino sin streaming", async () => {
    const casc = conCascada([modeloFalso("a", errorDeApi("quota exceeded", 400)), modeloFalso("b")])
    const r = await (casc as LanguageModelV3).doGenerate(PARAMS)
    expect((r as unknown as { content: { text: string }[] }).content[0].text).toBe("texto-de-b")
  })

  it("una cadena vacía es un error de programación, no algo que degradar en silencio", () => {
    expect(() => conCascada([])).toThrow()
  })
})

describe("leerCadena", () => {
  it("lee el formato modelo@proveedor de athos-service", () => {
    expect(leerCadena("claude-sonnet-5@anthropic,deepseek-v4@deepseek")).toEqual([
      { modelo: "claude-sonnet-5", proveedor: "anthropic" },
      { modelo: "deepseek-v4", proveedor: "deepseek" },
    ])
  })

  it("tolera espacios", () => {
    expect(leerCadena(" a@anthropic , b@deepseek ")).toHaveLength(2)
  })

  it("sin proveedor asume anthropic", () => {
    expect(leerCadena("claude-sonnet-5")).toEqual([{ modelo: "claude-sonnet-5", proveedor: "anthropic" }])
  })

  it("vacía o ausente = sin cascada", () => {
    expect(leerCadena("")).toEqual([])
    expect(leerCadena(undefined)).toEqual([])
    expect(leerCadena("  , ,  ")).toEqual([])
  })

  it("NO valida el proveedor: eso lo hace model.ts, que sabe qué SDKs hay", () => {
    expect(leerCadena("x@deepsek")).toEqual([{ modelo: "x", proveedor: "deepsek" }])
  })
})

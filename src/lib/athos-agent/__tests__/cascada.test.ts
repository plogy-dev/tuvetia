// La cascada entre proveedores del agente.
//
// Existe por un incidente real: el 2026-07-31 la cuenta de Anthropic se quedó sin crédito y el
// asistente se cayó entero, mientras el chat clínico —que sí tenía cascada— siguió respondiendo.
// La cascada estaba implementada sólo en athos-service (Python); esta superficie había quedado fuera.
import { describe, expect, it, vi } from "vitest"
import type { LanguageModel } from "ai"
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

import { conCascada, esFalloDeProveedor, leerCadena } from "@/lib/athos-agent/cascada"

/** Modelo falso: responde, o falla con el mensaje que se le indique. */
function modeloFalso(id: string, fallaCon?: string): LanguageModelV3 {
  const salida = { stream: `stream-de-${id}`, request: {}, response: {} }
  const gen = { content: [{ type: "text", text: `texto-de-${id}` }], finishReason: "stop" }
  return {
    specificationVersion: "v3",
    provider: "falso",
    modelId: id,
    supportedUrls: {},
    doStream: vi.fn(async () => {
      if (fallaCon) throw new Error(fallaCon)
      return salida
    }),
    doGenerate: vi.fn(async () => {
      if (fallaCon) throw new Error(fallaCon)
      return gen
    }),
  } as unknown as LanguageModelV3
}

const PARAMS = { prompt: [] } as unknown as LanguageModelV3CallOptions
const stream = (m: LanguageModel) => (m as LanguageModelV3).doStream(PARAMS)

describe("esFalloDeProveedor — sólo se reintenta lo que tiene sentido reintentar", () => {
  it.each([
    "Your credit balance is too low to access the Anthropic API",
    "insufficient_quota",
    "Invalid API key provided",
    "401 Unauthorized",
    "429 Too Many Requests",
    "Overloaded",
    "fetch failed",
    "ETIMEDOUT",
  ])("reintenta con: %s", (msg) => {
    expect(esFalloDeProveedor(new Error(msg))).toBe(true)
  })

  it.each([
    "Invalid tool definition: missing inputSchema",
    "El paciente no existe",
    "Cannot read properties of undefined",
  ])("NO reintenta con: %s", (msg) => {
    // Un error de nuestro código fallaría igual en el segundo proveedor: reintentarlo sólo gasta
    // dinero y tiempo.
    expect(esFalloDeProveedor(new Error(msg))).toBe(false)
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
    expect((b as unknown as { doStream: ReturnType<typeof vi.fn> }).doStream).not.toHaveBeenCalled()
  })

  it("SIN SALDO en el primario, responde el respaldo", async () => {
    // El caso exacto del 2026-07-31.
    const a = modeloFalso("anthropic", "Your credit balance is too low to access the Anthropic API")
    const b = modeloFalso("deepseek")
    const avisos: string[] = []
    const r = await stream(conCascada([a, b], (usado) => avisos.push(usado)))
    expect((r as unknown as { stream: string }).stream).toBe("stream-de-deepseek")
    expect(avisos).toEqual(["falso:deepseek"])
  })

  it("recorre la cadena entera hasta encontrar uno que responda", async () => {
    const r = await stream(
      conCascada([
        modeloFalso("uno", "429 rate limit"),
        modeloFalso("dos", "401 Unauthorized"),
        modeloFalso("tres"),
      ]),
    )
    expect((r as unknown as { stream: string }).stream).toBe("stream-de-tres")
  })

  it("un error NUESTRO no dispara la cascada", async () => {
    const b = modeloFalso("respaldo")
    const casc = conCascada([modeloFalso("a", "Invalid tool definition"), b])
    await expect(stream(casc)).rejects.toThrow("Invalid tool definition")
    expect((b as unknown as { doStream: ReturnType<typeof vi.fn> }).doStream).not.toHaveBeenCalled()
  })

  it("si NINGUNO responde, se propaga el error del PRIMARIO", async () => {
    // Es el que el equipo espera ver en el log: el del respaldo confundiría el diagnóstico.
    const casc = conCascada([
      modeloFalso("a", "credit balance too low"),
      modeloFalso("b", "429 rate limit"),
    ])
    await expect(stream(casc)).rejects.toThrow("credit balance too low")
  })

  it("también cubre el camino sin streaming", async () => {
    const casc = conCascada([modeloFalso("a", "quota exceeded"), modeloFalso("b")])
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
    expect(leerCadena("claude-sonnet-5")).toEqual([
      { modelo: "claude-sonnet-5", proveedor: "anthropic" },
    ])
  })

  it("vacía o ausente = sin cascada", () => {
    expect(leerCadena("")).toEqual([])
    expect(leerCadena(undefined)).toEqual([])
    expect(leerCadena("  , ,  ")).toEqual([])
  })
})

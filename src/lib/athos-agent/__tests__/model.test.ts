// La fábrica de modelos y su relación con la cascada.
//
// Lo que se protege acá es que el modelo que RESPONDE y el id que se PERSISTE no puedan
// desincronizarse. Antes eran dos funciones sueltas (`agentModel()` / `agentModelId()`): la primera
// respetaba `ATHOS_AGENT_CASCADE` y la segunda leía `ATHOS_AGENT_MODEL` por su cuenta, así que
// `athos_actions.proposed_by_model` guardaba el modelo equivocado. Es el mismo defecto que la
// Ola 2.1 del plan de remediación arregló en athos-service.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"

/** Modelo falso con la forma v3 que la cascada necesita para poder envolverlo. */
function falso(provider: string, modelId: string): LanguageModelV3 {
  const falla = fallos.get(`${provider}:${modelId}`)
  return {
    specificationVersion: "v3",
    provider,
    modelId,
    supportedUrls: {},
    doStream: vi.fn(async () => {
      if (falla) throw new Error(falla)
      return { stream: `stream-de-${modelId}`, request: {}, response: {} }
    }),
    doGenerate: vi.fn(async () => {
      if (falla) throw new Error(falla)
      return { content: [{ type: "text", text: modelId }], finishReason: "stop" }
    }),
  } as unknown as LanguageModelV3
}

/** Qué modelos deben fallar en el test que está corriendo. Clave: "proveedor:modelo". */
const fallos = new Map<string, string>()

vi.mock("@ai-sdk/anthropic", () => ({ anthropic: (id: string) => falso("anthropic", id) }))
vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: () => (id: string) => falso("deepseek", id),
}))

const { agentModel, autoModel, visionModel } = await import("@/lib/athos-agent/model")

const PARAMS = { prompt: [] } as unknown as LanguageModelV3CallOptions
const ENV = [
  "ATHOS_AGENT_CASCADE",
  "ATHOS_AUTO_CASCADE",
  "ATHOS_VISION_CASCADE",
  "ATHOS_AGENT_PROVIDER",
  "ATHOS_AGENT_MODEL",
  "ATHOS_AUTO_PROVIDER",
  "ATHOS_AUTO_MODEL",
  "ATHOS_VISION_MODEL",
] as const

beforeEach(() => {
  fallos.clear()
  for (const k of ENV) delete process.env[k]
})
afterEach(() => {
  for (const k of ENV) delete process.env[k]
})

describe("agentModel", () => {
  it("sin cascada, el id es el del modelo que se resolvió", () => {
    expect(agentModel().modelId).toBe("claude-sonnet-5")

    process.env.ATHOS_AGENT_MODEL = "claude-opus-4-8"
    expect(agentModel().modelId).toBe("claude-opus-4-8")
  })

  it("con cascada, el id es el PRIMERO DE LA CADENA — no ATHOS_AGENT_MODEL", () => {
    // El bug en su forma más silenciosa: sin ningún fallo, sólo por tener la cascada puesta, el id
    // que se persistía era el del par PROVIDER/MODEL, que puede no ser el que atiende.
    process.env.ATHOS_AGENT_MODEL = "claude-sonnet-5"
    process.env.ATHOS_AGENT_CASCADE = "deepseek-v4@deepseek,claude-sonnet-5@anthropic"

    const elegido = agentModel()
    expect(elegido.modelId).toBe("deepseek-v4")
    expect((elegido.model as LanguageModelV3).modelId).toBe("deepseek-v4")
  })

  it("si responde el respaldo, el id pasa a ser el DEL RESPALDO", async () => {
    // El caso del 2026-07-31, que es cuando la traza mentía.
    fallos.set("anthropic:claude-sonnet-5", "Your credit balance is too low")
    process.env.ATHOS_AGENT_CASCADE = "claude-sonnet-5@anthropic,deepseek-v4@deepseek"

    const elegido = agentModel()
    expect(elegido.modelId).toBe("claude-sonnet-5")

    await (elegido.model as LanguageModelV3).doStream(PARAMS)

    expect(elegido.modelId).toBe("deepseek-v4")
  })

  it("el id se reescribe ANTES de devolver la salida, que es cuando corren las tools", async () => {
    // Las tools que insertan en athos_actions se ejecutan después de que el proveedor aceptó la
    // petición. Si el aviso llegara tarde, la fila ya estaría escrita con el modelo equivocado.
    fallos.set("anthropic:claude-sonnet-5", "429 rate limit")
    process.env.ATHOS_AGENT_CASCADE = "claude-sonnet-5@anthropic,deepseek-v4@deepseek"

    const elegido = agentModel()
    const salida = await (elegido.model as LanguageModelV3).doStream(PARAMS)

    expect((salida as unknown as { stream: string }).stream).toBe("stream-de-deepseek-v4")
    expect(elegido.modelId).toBe("deepseek-v4")
  })

  it("un error NUESTRO no cambia el id ni toca el respaldo", async () => {
    fallos.set("anthropic:claude-sonnet-5", "Invalid tool definition: missing inputSchema")
    process.env.ATHOS_AGENT_CASCADE = "claude-sonnet-5@anthropic,deepseek-v4@deepseek"

    const elegido = agentModel()
    await expect((elegido.model as LanguageModelV3).doStream(PARAMS)).rejects.toThrow(
      "Invalid tool definition",
    )
    expect(elegido.modelId).toBe("claude-sonnet-5")
  })
})

describe("autoModel y visionModel", () => {
  it("el modo auto también cae al respaldo — le responde al CLIENTE, no al vet", async () => {
    fallos.set("anthropic:claude-haiku-4-5", "insufficient_quota")
    process.env.ATHOS_AUTO_CASCADE = "claude-haiku-4-5@anthropic,deepseek-v4@deepseek"

    const elegido = autoModel()
    await (elegido.model as LanguageModelV3).doGenerate(PARAMS)
    expect(elegido.modelId).toBe("deepseek-v4")
  })

  it("sin cascada, el modo auto hereda el proveedor del agente", () => {
    process.env.ATHOS_AGENT_PROVIDER = "deepseek"
    // `deepseek-v4-flash`, no `deepseek-v4`: ese último NO EXISTE. La API responde «The supported
    // API model names are deepseek-v4-pro or deepseek-v4-flash», así que el default anterior
    // reventaba en cuanto alguien ponía ATHOS_AGENT_PROVIDER=deepseek sin fijar el modelo.
    // Verificado contra la API real el 2026-08-01.
    expect(autoModel().modelId).toBe("deepseek-v4-flash")
  })

  it("visión sigue siendo Anthropic por defecto y admite su propia cascada", async () => {
    expect(visionModel().modelId).toBe("claude-haiku-4-5")

    fallos.set("anthropic:claude-haiku-4-5", "Overloaded")
    process.env.ATHOS_VISION_CASCADE = "claude-haiku-4-5@anthropic,claude-sonnet-5@anthropic"
    const elegido = visionModel()
    await (elegido.model as LanguageModelV3).doGenerate(PARAMS)
    expect(elegido.modelId).toBe("claude-sonnet-5")
  })
})

describe("lista blanca de proveedores", () => {
  beforeEach(() => ENV.forEach((k) => delete process.env[k]))
  afterEach(() => {
    fallos.clear()
    ENV.forEach((k) => delete process.env[k])
  })

  it("un typo en el proveedor NO se resuelve contra Anthropic en silencio", async () => {
    // Éste era el escenario peligroso: `@deepsek` caía al else del ternario y devolvía un modelo de
    // Anthropic, así que la "cascada" eran dos llamadas a la MISMA cuenta sin crédito — y nada en
    // los logs decía que el respaldo no existía.
    const avisos: string[] = []
    const warn = vi.spyOn(console, "warn").mockImplementation((m) => avisos.push(String(m)))

    fallos.set("anthropic:claude-sonnet-5", "Your credit balance is too low")
    process.env.ATHOS_AGENT_CASCADE = "claude-sonnet-5@anthropic,deepseek-v4-flash@deepsek"
    const elegido = agentModel()

    // El eslabón malo se descartó, así que queda un solo modelo y no hay respaldo que lo salve:
    // el fallo del primario se propaga en vez de fingir que había cascada.
    await expect((elegido.model as LanguageModelV3).doGenerate(PARAMS)).rejects.toThrow("credit")
    expect(avisos.some((a) => a.includes("deepsek") && a.includes("desconocido"))).toBe(true)
    warn.mockRestore()
  })

  it("con el proveedor bien escrito, el respaldo sí entra", async () => {
    fallos.set("anthropic:claude-sonnet-5", "Your credit balance is too low")
    process.env.ATHOS_AGENT_CASCADE = "claude-sonnet-5@anthropic,deepseek-v4-flash@deepseek"
    const elegido = agentModel()
    await (elegido.model as LanguageModelV3).doGenerate(PARAMS)
    expect(elegido.modelId).toBe("deepseek-v4-flash")
    expect(elegido.provider).toBe("deepseek")
  })

  it("si TODOS los eslabones son inválidos, cae al par PROVIDER/MODEL de siempre", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.ATHOS_AGENT_CASCADE = "x@openai,y@gemini"
    expect(agentModel().modelId).toBe("claude-sonnet-5")
    warn.mockRestore()
  })
})

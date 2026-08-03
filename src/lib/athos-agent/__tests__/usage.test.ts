// El registro de consumo del agente NO puede fallar en silencio.
//
// Este test existe por un defecto encontrado en el review del 2026-08-01: `.insert()` de supabase-js
// NO rechaza la promesa ante un error de la base — resuelve con `{ data, error }`. El try/catch que
// envolvía la llamada sólo atrapaba excepciones, así que un rechazo de RLS, una violación del check
// de `surface` o la tabla sin migrar pasaban sin dejar ni una línea de log. Justo el fallo
// silencioso que este registro existe para eliminar.
import { beforeEach, describe, expect, it, vi } from "vitest"

const insertMock = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: insertMock }) }),
}))

const { registrarUso } = await import("@/lib/athos-agent/usage")

const elegido = {
  model: {} as never,
  modelId: "claude-sonnet-5",
  provider: "anthropic",
  modeloPrimario: "claude-sonnet-5",
}

beforeEach(() => {
  insertMock.mockReset()
  vi.restoreAllMocks()
})

describe("registrarUso", () => {
  it("loguea cuando la BASE rechaza el insert (el caso que se tragaba)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    insertMock.mockResolvedValue({ error: { message: 'relation "athos_agent_usage" does not exist' } })

    await registrarUso({ clinicId: "c1", surface: "agent", elegido, usage: undefined })

    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0])).toContain("does not exist")
  })

  it("no loguea nada cuando el insert sale bien", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    insertMock.mockResolvedValue({ error: null })

    await registrarUso({ clinicId: "c1", surface: "agent", elegido, usage: undefined })

    expect(err).not.toHaveBeenCalled()
  })

  it("NUNCA lanza: una respuesta que el vet ya está leyendo no se cae por el registro", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    insertMock.mockRejectedValue(new Error("la red se cayó"))

    await expect(
      registrarUso({ clinicId: "c1", surface: "agent", elegido, usage: undefined }),
    ).resolves.toBeUndefined()
  })

  it("guarda null y no 0 cuando el proveedor no reporta tokens", async () => {
    // Un 0 se sumaría en /admin/costos como si la llamada no hubiera costado nada.
    insertMock.mockResolvedValue({ error: null })

    await registrarUso({ clinicId: "c1", surface: "agent", elegido, usage: undefined })

    expect(insertMock.mock.calls[0][0]).toMatchObject({ tokens_in: null, tokens_out: null })
  })

  it("marca fell_back_from sólo cuando respondió un respaldo", async () => {
    insertMock.mockResolvedValue({ error: null })

    await registrarUso({ clinicId: "c1", surface: "agent", elegido, usage: undefined })
    expect(insertMock.mock.calls[0][0]).toMatchObject({ fell_back_from: null })

    insertMock.mockClear()
    await registrarUso({
      clinicId: "c1",
      surface: "agent",
      elegido: { ...elegido, modelId: "deepseek-v4", provider: "deepseek" },
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      model: "deepseek-v4",
      fell_back_from: "claude-sonnet-5",
      tokens_in: 10,
      tokens_out: 5,
    })
  })
})

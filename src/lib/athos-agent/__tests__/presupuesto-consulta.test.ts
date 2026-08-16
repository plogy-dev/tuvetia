// La mitad de `presupuesto.ts` que habla con la base. La lógica pura está en
// `src/lib/__tests__/presupuesto.test.ts`; acá se fija el comportamiento que sólo se ve con la
// consulta delante: que con el tope apagado no se consulte nada, y que un fallo de la base deje pasar.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const select = vi.fn()

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: (...a: unknown[]) => {
        select(...a)
        return {
          eq: () => ({ gte: async () => respuesta }),
        }
      },
    }),
  }),
}))

let respuesta: { count: number | null; error: { message: string } | null } = { count: 0, error: null }

import { consultarPresupuesto, TOPE_DE_SEGURIDAD } from "@/lib/athos-agent/presupuesto"

const AHORA = new Date("2026-08-15T12:00:00Z")

beforeEach(() => {
  vi.clearAllMocks()
  respuesta = { count: 0, error: null }
})
afterEach(() => vi.unstubAllEnvs())

describe("consultarPresupuesto", () => {
  it("con el tope APAGADO a propósito no consulta la base", async () => {
    // Es una consulta por cada turno del agente, en todas las clínicas, que no cambiaría ninguna
    // decisión. Cuando alguien apaga el tope, no debe costar ni un round-trip.
    //
    // Antes este caso era "sin la variable", que era el estado por defecto. Ya no: sin variable hay
    // tope de contención, y apagarlo pasó a exigir decirlo — `ATHOS_TOPE_MENSUAL_POR_CLINICA=ninguno`.
    vi.stubEnv("ATHOS_TOPE_MENSUAL_POR_CLINICA", "ninguno")
    const p = await consultarPresupuesto("c1", AHORA)
    expect(select).not.toHaveBeenCalled()
    expect(p.permitido).toBe(true)
    expect(p.tope).toBeNull()
  })

  it("sin la variable SÍ consulta: el tope de contención está activo por defecto", async () => {
    // El cambio del 2026-08-16. La variable no estaba puesta en Vercel y por lo tanto el gasto de IA
    // no tenía ningún techo en producción; ahora el defecto es contener.
    const p = await consultarPresupuesto("c1", AHORA)
    expect(select).toHaveBeenCalled()
    expect(p.tope).toBe(TOPE_DE_SEGURIDAD)
  })

  it("cuenta sin traer filas: `head: true`", async () => {
    vi.stubEnv("ATHOS_TOPE_MENSUAL_POR_CLINICA", "500")
    await consultarPresupuesto("c1", AHORA)
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true })
  })

  it("por debajo del tope deja pasar", async () => {
    vi.stubEnv("ATHOS_TOPE_MENSUAL_POR_CLINICA", "500")
    respuesta = { count: 499, error: null }
    const p = await consultarPresupuesto("c1", AHORA)
    expect(p.permitido).toBe(true)
    expect(p.restantes).toBe(1)
  })

  it("alcanzado el tope, BLOQUEA", async () => {
    vi.stubEnv("ATHOS_TOPE_MENSUAL_POR_CLINICA", "500")
    respuesta = { count: 500, error: null }
    const p = await consultarPresupuesto("c1", AHORA)
    expect(p.permitido).toBe(false)
    expect(p.usadas).toBe(500)
  })

  it("si la base falla, FALLA ABIERTA: el vet no se queda sin Athos por un count", async () => {
    // Mismo criterio que el juez de evidencia y la verificación de citas en este repo. Dejar a un
    // veterinario sin el asistente en medio de una consulta porque una consulta de conteo no
    // respondió es peor que pasarse del tope.
    vi.stubEnv("ATHOS_TOPE_MENSUAL_POR_CLINICA", "500")
    respuesta = { count: null, error: { message: "statement timeout" } }
    const p = await consultarPresupuesto("c1", AHORA)
    expect(p.permitido).toBe(true)
  })

  it("un count nulo sin error se trata como cero, no como bloqueo", async () => {
    vi.stubEnv("ATHOS_TOPE_MENSUAL_POR_CLINICA", "500")
    respuesta = { count: null, error: null }
    const p = await consultarPresupuesto("c1", AHORA)
    expect(p.permitido).toBe(true)
    expect(p.usadas).toBe(0)
  })
})

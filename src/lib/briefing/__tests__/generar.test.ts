// El barrido del briefing, que es lo único de la capa agéntica que le cuesta plata a la clínica.
//
// LO QUE SE CUENTA ACÁ SON LLAMADAS AL MODELO, no comportamiento. Una guarda que se rompa no falla
// ni avisa: simplemente empieza a cobrar en silencio, todos los días, para todas las clínicas. Por
// eso cada test afirma sobre `generateText.mock.calls.length` y no sobre lo que devuelve el barrido.

import { beforeEach, describe, expect, it, vi } from "vitest"

const generateText = vi.fn()
const registrarUso = vi.fn()

/** Filas por tabla. `clinics` manda quiénes entran al barrido. */
let tablas: Record<string, unknown[]> = {}
/** Lo que se insertó, por tabla. */
let insertados: { tabla: string; datos: Record<string, unknown> }[] = []
/** Error a devolver en el INSERT de `clinic_briefings`. */
let errorInsert: { message: string } | null = null

vi.mock("ai", () => ({
  generateText: (...a: unknown[]) => generateText(...a),
}))

vi.mock("@/lib/athos-agent/model", () => ({
  agentModel: () => ({ model: {}, modelId: "modelo-de-prueba" }),
}))

vi.mock("@/lib/athos-agent/usage", () => ({
  registrarUso: (...a: unknown[]) => registrarUso(...a),
}))

// Las señales tienen sus propios tests; acá sólo importa si hay algo que contar o no.
vi.mock("@/lib/senales/consultar", () => ({
  senalesDeLaClinica: vi.fn(async () => ({
    pendientes: tablas.__pendientes ?? [],
    cobrosVencidos: { cuantas: 0, totalCents: 0 },
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabla: string) => {
      const nodo: Record<string, unknown> = {}
      for (const m of ["select", "eq", "gte", "lte", "in", "order", "limit"]) nodo[m] = () => nodo
      nodo.maybeSingle = async () => ({ data: (tablas[tabla] ?? [])[0] ?? null, error: null })
      nodo.insert = async (datos: Record<string, unknown>) => {
        insertados.push({ tabla, datos })
        return { error: errorInsert }
      }
      nodo.then = (r: (v: unknown) => unknown) => r({ data: tablas[tabla] ?? [], error: null })
      return nodo
    },
  }),
}))

import { generarBriefings } from "@/lib/briefing/generar"

const HOY = "2026-08-16"
const CLINICA = { id: "cli-1", name: "Clínica Norte" }
const PENDIENTE = { id: "notas-sin-aprobar", etiqueta: "3 notas sin aprobar", detalle: "d" }

beforeEach(() => {
  vi.clearAllMocks()
  tablas = {}
  insertados = []
  errorInsert = null
  generateText.mockResolvedValue({ text: "Tenés 3 notas sin aprobar.", usage: { inputTokens: 100, outputTokens: 20 } })
})

describe("guarda 1 · el interruptor de la clínica", () => {
  // El filtro está en SQL (`.eq("briefing_enabled", true)`), así que una clínica apagada no aparece
  // en la lista. Se prueba desde el efecto: si no está, no se la llama.
  it("una clínica que no está en la lista no cuesta NADA", async () => {
    tablas = { clinics: [], __pendientes: [PENDIENTE] }

    const r = await generarBriefings(HOY)

    expect(generateText).not.toHaveBeenCalled()
    expect(r.clinicas).toBe(0)
    expect(r.redactados).toBe(0)
  })
})

describe("guarda 2 · ya hay uno de hoy", () => {
  // La restricción `unique (clinic_id, fecha)` es la garantía dura, pero preguntar ANTES evita
  // armar el pedido y pagar la llamada para que el INSERT la rechace después.
  it("con un briefing de hoy ya escrito, NO se llama al modelo", async () => {
    tablas = { clinics: [CLINICA], clinic_briefings: [{ id: "b1" }], __pendientes: [PENDIENTE] }

    const r = await generarBriefings(HOY)

    expect(generateText).not.toHaveBeenCalled()
    expect(r.omitidos).toEqual([{ clinicId: "cli-1", motivo: "ya-existe" }])
  })

  // Si dos barridos corren a la vez, el segundo choca contra la restricción. Eso NO es un error que
  // haya que reportar: significa que el otro ganó.
  it("si el INSERT choca con la restricción, se cuenta como 'ya existe' y no como fallo", async () => {
    tablas = { clinics: [CLINICA], __pendientes: [PENDIENTE] }
    errorInsert = { message: 'duplicate key value violates unique constraint "clinic_briefings_unicos_por_dia"' }

    const r = await generarBriefings(HOY)

    expect(r.omitidos).toEqual([{ clinicId: "cli-1", motivo: "ya-existe" }])
    expect(r.fallidos).toEqual([])
  })
})

describe("guarda 3 · nada que contar", () => {
  // Un briefing que diga "hoy no tenés nada" cuesta lo mismo que uno útil.
  it("sin pendientes y sin citas NO se llama al modelo", async () => {
    tablas = { clinics: [CLINICA], __pendientes: [] }

    const r = await generarBriefings(HOY)

    expect(generateText).not.toHaveBeenCalled()
    expect(r.omitidos).toEqual([{ clinicId: "cli-1", motivo: "nada-que-contar" }])
  })

  // Un modelo que devuelve vacío no puede escribir una fila en blanco.
  it("si el modelo devuelve vacío, no se guarda nada", async () => {
    tablas = { clinics: [CLINICA], __pendientes: [PENDIENTE] }
    generateText.mockResolvedValue({ text: "   ", usage: {} })

    const r = await generarBriefings(HOY)

    expect(insertados.filter((i) => i.tabla === "clinic_briefings")).toHaveLength(0)
    expect(r.redactados).toBe(0)
  })
})

describe("cuando SÍ redacta", () => {
  it("llama al modelo UNA vez y guarda el texto con su fecha", async () => {
    tablas = { clinics: [CLINICA], __pendientes: [PENDIENTE] }

    const r = await generarBriefings(HOY)

    expect(generateText).toHaveBeenCalledTimes(1)
    expect(r.redactados).toBe(1)
    const fila = insertados.find((i) => i.tabla === "clinic_briefings")
    expect(fila?.datos).toMatchObject({ clinic_id: "cli-1", fecha: HOY, ai_model: "modelo-de-prueba" })
    expect(fila?.datos.texto).toBe("Tenés 3 notas sin aprobar.")
  })

  // Es gasto que ocurre SIN que ningún vet lo haya pedido: tiene que verse aparte en /admin/costos
  // y no diluido dentro de "agent".
  it("registra el consumo con su propia superficie", async () => {
    tablas = { clinics: [CLINICA], __pendientes: [PENDIENTE] }

    await generarBriefings(HOY)

    expect(registrarUso).toHaveBeenCalledTimes(1)
    expect(registrarUso.mock.calls[0][0]).toMatchObject({ clinicId: "cli-1", surface: "briefing" })
  })

  it("guarda las señales que había, para poder explicar por qué dijo lo que dijo", async () => {
    tablas = { clinics: [CLINICA], __pendientes: [PENDIENTE] }

    await generarBriefings(HOY)

    expect(insertados.find((i) => i.tabla === "clinic_briefings")?.datos.senales).toEqual([PENDIENTE])
  })
})

describe("una clínica que falla no se lleva el barrido", () => {
  it("las demás siguen", async () => {
    tablas = { clinics: [CLINICA, { id: "cli-2", name: "Otra" }], __pendientes: [PENDIENTE] }
    generateText.mockRejectedValueOnce(new Error("el proveedor se cayó"))

    const r = await generarBriefings(HOY)

    expect(r.fallidos).toHaveLength(1)
    expect(r.redactados).toBe(1) // la segunda sí salió
  })
})

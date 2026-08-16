// El lector de señales contra la base.
//
// DOS COSAS QUE FIJA, y las dos son invariantes de la casa:
//
//  1. AISLAMIENTO POR CLÍNICA. Cada consulta filtra por `clinic_id`. La RLS ya lo haría, pero acá
//     hay `service_role` en juego en otras rutas del repo y la regla es explícita: `clinic_id`
//     siempre a mano. Una señal que se filtre entre clínicas le muestra a un vet el trabajo
//     pendiente de otra veterinaria.
//
//  2. FALLA HACIA EL SILENCIO. Si una consulta se cae, esa señal desaparece y las demás siguen. Un
//     riel al que le falta una línea es molesto; uno que rompe la pantalla de inicio porque
//     `vaccines` no respondió es inaceptable.

import { beforeEach, describe, expect, it, vi } from "vitest"

import { senalesDeLaClinica } from "@/lib/senales/consultar"

const HOY = "2026-08-16"
const CLINICA = "cli-1"

/** Filtros aplicados por tabla, para inspeccionar el aislamiento. */
let filtros: { tabla: string; columna: string; valor: unknown }[] = []
/** Qué devuelve cada tabla. Una entrada con `error` simula la caída de esa consulta. */
let respuestas: Record<string, { data?: unknown[]; error?: { message: string } }> = {}

function clienteFalso() {
  return {
    from: (tabla: string) => {
      const nodo: Record<string, unknown> = {}
      for (const m of ["select", "order", "limit", "not", "lte", "gt", "gte"]) {
        nodo[m] = () => nodo
      }
      nodo.eq = (columna: string, valor: unknown) => {
        filtros.push({ tabla, columna, valor })
        return nodo
      }
      nodo.then = (r: (v: unknown) => unknown) =>
        r(respuestas[tabla] ?? { data: [], error: null })
      return nodo
    },
  } as never
}

beforeEach(() => {
  filtros = []
  respuestas = {}
  vi.restoreAllMocks()
})

describe("aislamiento por clínica", () => {
  // EL TEST OBLIGATORIO. Si una señal olvidara su `clinic_id`, un vet vería las notas sin aprobar
  // de otra veterinaria en su propia pantalla de inicio.
  it("las CUATRO señales filtran por clinic_id", async () => {
    await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)

    const conClinica = new Set(
      filtros.filter((f) => f.columna === "clinic_id" && f.valor === CLINICA).map((f) => f.tabla),
    )
    expect(conClinica).toEqual(
      new Set(["clinical_notes", "whatsapp_messages", "vaccines", "human_tasks", "invoices"]),
    )
  })

  it("ninguna consulta usa una clínica distinta de la pedida", async () => {
    await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)

    const otras = filtros.filter((f) => f.columna === "clinic_id" && f.valor !== CLINICA)
    expect(otras).toEqual([])
  })
})

describe("falla hacia el silencio", () => {
  it("si se cae una consulta, las demás siguen dando su señal", async () => {
    respuestas = {
      vaccines: { error: { message: "timeout" } },
      clinical_notes: { data: [{ status: "draft" }, { status: "draft" }] },
    }

    const r = await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)

    expect(r.pendientes.map((p) => p.id)).toContain("notas-sin-aprobar")
    expect(r.pendientes.map((p) => p.id)).not.toContain("vacunas")
  })

  // LA MITAD QUE FALTABA. Degradar está bien; degradar EN SILENCIO no. Sin esto, "la clínica está
  // al día" y "no pude averiguarlo" se ven idénticos desde afuera — y eso fue exactamente lo que
  // hizo indiagnosticable que el briefing se saltara dos clínicas con notas pendientes el
  // 2026-08-16.
  it("la consulta que falló queda ANOTADA, no sólo descartada", async () => {
    respuestas = { vaccines: { error: { message: "timeout" } } }

    const r = await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)

    expect(r.caidas).toEqual(["vaccines"])
  })

  it("se anotan TODAS las que fallaron, no sólo la primera", async () => {
    for (const t of ["clinical_notes", "whatsapp_messages", "vaccines", "human_tasks", "invoices"]) {
      respuestas[t] = { error: { message: "caído" } }
    }

    const r = await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)

    expect(r.caidas.sort()).toEqual(
      ["clinical_notes", "human_tasks", "invoices", "vaccines", "whatsapp_messages"],
    )
  })

  it("cuando todo responde, no hay caídas que reportar", async () => {
    expect((await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)).caidas).toEqual([])
  })

  it("si se caen TODAS, devuelve vacío en vez de romper", async () => {
    for (const t of ["clinical_notes", "whatsapp_messages", "vaccines", "human_tasks", "invoices"]) {
      respuestas[t] = { error: { message: "caído" } }
    }

    const r = await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)

    expect(r.pendientes).toEqual([])
    expect(r.cobrosVencidos).toEqual({ cuantas: 0, totalCents: 0 })
  })
})

describe("los cobros vencidos se comparan contra el día de BOGOTÁ", () => {
  // `due_date` es una columna DATE, o sea el calendario del negocio. Compararla con un instante UTC
  // adelantaría el vencimiento un día — una factura que vence hoy figuraría vencida desde las 19:00
  // de ayer. Mismo criterio que el resto de facturación.
  it("una factura que vence HOY todavía no está vencida", async () => {
    respuestas = {
      invoices: { data: [{ balance_cents: 50_000, due_date: HOY }] },
    }

    const r = await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)

    expect(r.cobrosVencidos.cuantas).toBe(0)
  })

  it("una que venció ayer sí cuenta, con su monto", async () => {
    respuestas = {
      invoices: {
        data: [
          { balance_cents: 50_000, due_date: "2026-08-15" },
          { balance_cents: 25_000, due_date: "2026-08-01" },
        ],
      },
    }

    const r = await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)

    expect(r.cobrosVencidos).toEqual({ cuantas: 2, totalCents: 75_000 })
    expect(r.pendientes.find((p) => p.id === "cobros-vencidos")?.detalle).toBe("$ 750")
  })

  it("una factura sin saldo no es un cobro vencido", async () => {
    respuestas = { invoices: { data: [{ balance_cents: 0, due_date: "2026-08-01" }] } }

    expect((await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)).cobrosVencidos.cuantas).toBe(0)
  })
})

describe("todo junto", () => {
  it("una clínica con trabajo pendiente lo reporta ordenado", async () => {
    respuestas = {
      clinical_notes: { data: [{ status: "draft" }] },
      whatsapp_messages: {
        data: [{ owner_id: "o1", direction: "inbound", created_at: "2026-08-15T10:00:00Z" }],
      },
      invoices: { data: [{ balance_cents: 10_000, due_date: "2026-08-01" }] },
    }

    const r = await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)

    expect(r.pendientes.map((p) => p.id)).toEqual([
      "conversaciones",
      "notas-sin-aprobar",
      "cobros-vencidos",
    ])
  })

  it("una clínica al día no reporta nada", async () => {
    expect((await senalesDeLaClinica(clienteFalso(), CLINICA, HOY)).pendientes).toEqual([])
  })
})

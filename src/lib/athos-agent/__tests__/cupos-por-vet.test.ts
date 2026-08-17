// La agenda es de UNA persona, no de la clínica.
//
// EL DEFECTO QUE ESTO FIJA. `list_available_slots` restaba TODAS las citas de la clínica sin mirar
// de quién eran, así que una clínica con tres veterinarios aparecía ocupada cuando sólo uno lo
// estaba. Y ya hay clínicas con más de uno —la de Santiago tiene dos—, así que no es hipotético.
//
// El segundo defecto era más silencioso: la consulta excluía sólo `canceled`, así que un `no_show`
// —una cita a la que el titular no vino— seguía tapando un cupo que en la práctica quedó libre.
//
// SE PRUEBA SOBRE LOS FILTROS Y NO SOBRE EL RESULTADO. Lo que puede volver a romperse es la
// CONSULTA: que alguien la reescriba y pierda el `eq("vet_id")`. El cálculo de cupos en sí ya está
// cubierto por los tests de `calcularCupos`, que es una función pura.

import { beforeEach, describe, expect, it, vi } from "vitest"

/** Cada llamada encadenada que la tool hizo, para poder afirmar sobre ella. */
type Llamada = { tabla: string; metodo: string; args: unknown[] }
let llamadas: Llamada[] = []

/** Filas que devuelve cada tabla. `clinic_hours` tiene que traer algo o la tool corta antes. */
const respuestas: Record<string, unknown[]> = {
  clinic_hours: [{ opens_at: "08:00", closes_at: "18:00", slot_minutes: 30 }],
  appointments: [],
}

function nodo(tabla: string) {
  const self: Record<string, unknown> = {}
  for (const m of ["select", "eq", "gte", "lt", "lte", "in", "order", "neq", "limit"]) {
    self[m] = (...args: unknown[]) => {
      llamadas.push({ tabla, metodo: m, args })
      return self
    }
  }
  // Thenable: es lo que hace que `await`/`Promise.all` sobre la cadena resuelva.
  self.then = (resolver: (v: unknown) => unknown) =>
    resolver({ data: respuestas[tabla] ?? [], error: null })
  return self
}

const supabaseFalso = { from: (tabla: string) => nodo(tabla) } as never

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => supabaseFalso }))
vi.mock("@/lib/composio/correo", () => ({
  estadoConexion: async () => ({ conectado: false, proveedor: null, email: null }),
}))

const { buildAthosTools } = await import("@/lib/athos-agent/tools")

/**
 * Invoca el `execute` de una tool.
 *
 * Doble cast a traves de `unknown` porque el tipo `Tool` del SDK declara `execute` como OPCIONAL
 * —hay tools sin ejecucion local, como las del proveedor— y un cast directo no compila. Acá se sabe
 * que existe: es una tool de lectura propia.
 */
function ejecutar(t: unknown): (a: unknown) => Promise<unknown> {
  return (t as unknown as { execute: (a: unknown) => Promise<unknown> }).execute
}

// Misma forma que usa `agent-smoke.test.ts`: `buildAthosTools` la exige entera.
const ctx = {
  userId: "vet-1",
  clinicId: "clinic-1",
  source: "chat" as const,
  conversationKey: "pac-1",
  patientId: "pac-1",
  accessToken: "jwt",
  model: "deepseek-v4-flash",
}

/** Los filtros de la consulta a `appointments`, que es la que importa. */
function filtrosDeCitas() {
  return llacitas().filter((l) => l.metodo === "eq" || l.metodo === "in" || l.metodo === "neq")
}
function llacitas() {
  return llamadas.filter((l) => l.tabla === "appointments")
}

beforeEach(() => {
  llamadas = []
})

describe("los cupos se calculan contra la agenda de UN veterinario", () => {
  it("con vet_id, la consulta filtra por ese veterinario", async () => {
    const tools = buildAthosTools(supabaseFalso, ctx)
    await ejecutar(tools.list_available_slots)({
      date: "2026-09-01",
      vet_id: "11111111-1111-1111-1111-111111111111",
    })

    const porVet = filtrosDeCitas().filter(
      (l) => l.metodo === "eq" && l.args[0] === "vet_id",
    )
    expect(
      porVet,
      "sin este filtro, una clínica con varios veterinarios aparece llena cuando sólo uno lo está",
    ).toHaveLength(1)
    expect(porVet[0].args[1]).toBe("11111111-1111-1111-1111-111111111111")
  })

  it("sin vet_id NO filtra por veterinario — es el modo conservador, y es explícito", async () => {
    const tools = buildAthosTools(supabaseFalso, ctx)
    await ejecutar(tools.list_available_slots)({
      date: "2026-09-01",
    })

    expect(filtrosDeCitas().some((l) => l.metodo === "eq" && l.args[0] === "vet_id")).toBe(false)
  })
})

describe("qué estados tapan un cupo", () => {
  // Los MISMOS que `ESTADOS_VIVOS` en calendario/page.tsx y que el trigger de la 0067. Tres
  // definiciones distintas de "cita viva" producirían una agenda que muestra una cosa, una base que
  // impide otra y un agente que propone una tercera.
  it("sólo scheduled, confirmed e in_progress", async () => {
    const tools = buildAthosTools(supabaseFalso, ctx)
    await ejecutar(tools.list_available_slots)({
      date: "2026-09-01",
    })

    const porEstado = filtrosDeCitas().find((l) => l.metodo === "in" && l.args[0] === "status")
    expect(porEstado, "la consulta ya no debería usar `neq` sobre el estado").toBeDefined()
    expect(porEstado!.args[1]).toEqual(["scheduled", "confirmed", "in_progress"])
  })

  // El caso que motivó cambiarlo: antes se excluía sólo `canceled`, así que un plantón seguía
  // tapando un cupo que de hecho quedó libre.
  it("un no_show ya no tapa un cupo", async () => {
    const tools = buildAthosTools(supabaseFalso, ctx)
    await ejecutar(tools.list_available_slots)({
      date: "2026-09-01",
    })

    const estados = filtrosDeCitas().find((l) => l.metodo === "in")?.args[1] as string[]
    expect(estados).not.toContain("no_show")
    expect(estados).not.toContain("canceled")
  })
})

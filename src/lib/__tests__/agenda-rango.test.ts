/**
 * El rango del calendario para la consulta de citas (`normalizarRango`).
 *
 * Fija el bug del 27-ago: la vista DÍA manda un array de UNA fecha (la medianoche del día) y el
 * rango colapsaba a 00:00-00:00 — la recarga devolvía cero citas y «la cita desaparecía». El
 * mismo defecto se comía en silencio las citas del último día de la semana.
 */
import { describe, expect, it } from "vitest"

import { normalizarRango } from "@/lib/agenda/rango"

describe("normalizarRango", () => {
  it("vista DÍA (array de una fecha): el rango cubre el día COMPLETO, no su medianoche", () => {
    const dia = new Date("2026-08-27T00:00:00")
    const { start, end } = normalizarRango([dia])
    expect(start).toEqual(dia)
    expect(end.getHours()).toBe(23)
    expect(end.getMinutes()).toBe(59)
    // una cita de las 10:00 de ese día queda DENTRO del rango
    const cita = new Date("2026-08-27T10:00:00")
    expect(cita >= start && cita <= end).toBe(true)
  })

  it("vista SEMANA (array de 7 fechas): el último día entra completo", () => {
    const dias = Array.from({ length: 7 }, (_, i) => new Date(2026, 7, 23 + i)) // dom 23 → sáb 29
    const { start, end } = normalizarRango(dias)
    expect(start).toEqual(dias[0])
    const citaDelSabado = new Date(2026, 7, 29, 15, 0)
    expect(citaDelSabado <= end).toBe(true)
  })

  it("vista MES (objeto {start, end}): pasa tal cual", () => {
    const r = { start: new Date(2026, 7, 1), end: new Date(2026, 8, 5) }
    expect(normalizarRango(r)).toEqual(r)
  })
})

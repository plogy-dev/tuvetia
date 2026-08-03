/**
 * `due_date` es una columna DATE, y ahí es donde se cuela el corrimiento de zona.
 *
 * Estos tests fijan un instante REAL cerca del borde (después de las 19:00 hora Colombia, que es
 * medianoche UTC) porque es el único momento en que el defecto aparece. Un test que use `new Date()`
 * a media tarde pasa igual con el código roto — de hecho `reminders.test.ts` construye sus fechas con
 * `new Date(2026,6,17,10,0)` y asierta con `.getHours()`, que es tautológico respecto de la zona y
 * por eso no lo detectó.
 */
import { describe, expect, it } from "vitest"

import { daysOverdue } from "@/lib/facturacion/domain/aging"
import { finDelDiaBogota } from "@/lib/date-utils"
import { fmtDate } from "@/lib/facturacion/format"

// 20:00 del 15 de agosto en Bogotá. En UTC ya es el 16 — ése es el borde que rompía todo.
const NOCHE_DEL_15 = new Date("2026-08-15T20:00:00-05:00")

describe("finDelDiaBogota", () => {
  it("una factura está al día durante TODO su día de vencimiento", () => {
    const vence = finDelDiaBogota("2026-08-15")!
    expect(NOCHE_DEL_15.getTime() > vence.getTime()).toBe(false)
  })

  it("vencida recién al empezar el día siguiente", () => {
    const vence = finDelDiaBogota("2026-08-15")!
    expect(new Date("2026-08-16T00:01:00-05:00").getTime() > vence.getTime()).toBe(true)
  })

  it("el corte es la medianoche de Bogotá, no la de UTC", () => {
    // Con `new Date('2026-08-15')` el corte caía 29 h antes: 19:00 del 14.
    expect(finDelDiaBogota("2026-08-15")!.toISOString()).toBe("2026-08-16T05:00:00.000Z")
  })

  it("rueda de mes sin ayuda", () => {
    expect(finDelDiaBogota("2026-08-31")!.toISOString()).toBe("2026-09-01T05:00:00.000Z")
  })

  it("una fecha ilegible devuelve null en vez de una fecha inventada", () => {
    expect(finDelDiaBogota("no-es-fecha")).toBeNull()
  })
})

describe("daysOverdue", () => {
  it("lo que vence hoy no está vencido, ni siquiera de noche", () => {
    // Acá estaba el defecto: con los getters locales del proceso (UTC en Vercel), a las 20:00 de
    // Colombia `nowMid` ya era el 16 y esto devolvía 1.
    expect(daysOverdue("2026-08-15", NOCHE_DEL_15)).toBe(0)
  })

  it("cuenta días enteros de calendario", () => {
    expect(daysOverdue("2026-08-15", new Date("2026-08-16T09:00:00-05:00"))).toBe(1)
    expect(daysOverdue("2026-08-15", new Date("2026-09-14T09:00:00-05:00"))).toBe(30)
  })

  it("aún no vencida da negativo, no cero", () => {
    expect(daysOverdue("2026-08-20", NOCHE_DEL_15)).toBe(-5)
  })

  it("sin fecha de vencimiento, no hay mora", () => {
    expect(daysOverdue(null, NOCHE_DEL_15)).toBe(0)
  })
})

describe("fmtDate", () => {
  it("una columna DATE se imprime tal cual, sin retroceder un día", () => {
    // Antes salía "14 de ago": `new Date('2026-08-15')` es medianoche UTC y formatear eso en
    // Bogotá lo lleva al día anterior.
    expect(fmtDate("2026-08-15")).toMatch(/15/)
    expect(fmtDate("2026-08-15")).not.toMatch(/14/)
  })

  it("un instante con hora se sigue viendo desde Bogotá", () => {
    // 00:30 UTC del 16 son las 19:30 del 15 en Colombia: acá SÍ hay que convertir.
    expect(fmtDate("2026-08-16T00:30:00Z")).toMatch(/15/)
  })

  it("sin fecha, guion", () => {
    expect(fmtDate(null)).toBe("—")
  })
})

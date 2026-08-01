import { describe, expect, it } from "vitest"

import { bogotaDateOnly, bogotaDateTime } from "@/lib/date-utils"

// Las columnas DATE y las TIMESTAMPTZ necesitan tratamientos OPUESTOS, y confundirlos corre la
// fecha un día en cada dirección. La ficha del paciente formateaba `vaccines.administered_at`
// —que es DATE— con el helper de instantes, y mostraba la vacuna un día ANTES de la guardada.
//
// Las aserciones van por partes y no contra la cadena completa a propósito: el separador que
// `es-CO` mete entre día y mes ("01 de ago de 2026") depende de la versión de ICU del runtime, y no
// es lo que este test protege. Lo que protege es que el día no se corra.
describe("bogotaDateOnly", () => {
  it("no corre el día de una columna DATE", () => {
    const salida = bogotaDateOnly("2026-08-01")
    expect(salida).toContain("01")
    expect(salida).toContain("ago")
    expect(salida).toContain("2026")
    expect(salida).not.toContain("jul")
  })

  it("y el helper de instantes SÍ lo corre — que es justo el defecto", () => {
    // Documenta por qué existe la función nueva: mismo string, un día menos y una hora inventada.
    expect(bogotaDateTime("2026-08-01")).toContain("31")
    expect(bogotaDateTime("2026-08-01")).toContain("jul")
  })

  it("el primero de enero no se va al año anterior", () => {
    // El corrimiento de -5 h sobre medianoche UTC es peor en el borde de año.
    const salida = bogotaDateOnly("2026-01-01")
    expect(salida).toContain("2026")
    expect(salida).not.toContain("2025")
    expect(salida).not.toContain("dic")
  })

  it("no inventa una hora que la columna no tiene", () => {
    expect(bogotaDateOnly("2026-08-01")).not.toContain(":")
  })

  it("devuelve el valor crudo si no es una fecha reconocible", () => {
    // Antes de romper el render, mostrar lo que hay.
    expect(bogotaDateOnly("")).toBe("")
    expect(bogotaDateOnly("no-es-fecha")).toBe("no-es-fecha")
  })
})

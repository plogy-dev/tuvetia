import { describe, expect, it } from "vitest"

import { franjaDelDia, saludoCompleto, saludoDe } from "@/lib/saludo"

// LO QUE SE PRUEBA SON LOS BORDES. Nadie abre la app a las 00:00 ni a las 13:59 para ver qué dice,
// así que si una frontera está corrida se descubre por un reporte de alguien, meses después. Antes
// había dos cortes y a las 11:59 saludaba igual que a las 6 de la mañana.

describe("franjaDelDia", () => {
  it.each([
    [0, "madrugada"],
    [4, "madrugada"],
    [5, "manana"],
    [11, "manana"],
    [12, "mediodia"],
    [13, "mediodia"],
    [14, "tarde"],
    [18, "tarde"],
    [19, "noche"],
    [23, "noche"],
  ])("las %i:00 son %s", (hora, esperada) => {
    expect(franjaDelDia(hora as number)).toBe(esperada)
  })

  it("cubre las 24 horas sin huecos", () => {
    // Si alguien mueve un corte y deja un hueco, el día entero deja de estar cubierto y alguna hora
    // caería en el default silenciosamente.
    for (let h = 0; h <= 23; h++) {
      expect(franjaDelDia(h), `la hora ${h} quedó sin franja`).toBeTruthy()
    }
  })

  it("una hora imposible cae en el saludo más neutro, sin romper", () => {
    expect(franjaDelDia(-1)).toBe("manana")
    expect(franjaDelDia(24)).toBe("manana")
    expect(franjaDelDia(NaN)).toBe("manana")
  })
})

describe("saludoDe", () => {
  it("cambia a lo largo del día — que es todo el punto", () => {
    // El defecto reportado: "el Athos siempre dice buenos días".
    const delDia = [3, 9, 12, 16, 21].map(saludoDe)
    expect(new Set(delDia).size).toBeGreaterThan(1)
  })

  it("a media mañana dice buenos días, y a media tarde no", () => {
    expect(saludoDe(9)).toBe("Buenos días")
    expect(saludoDe(16)).toBe("Buenas tardes")
    expect(saludoDe(21)).toBe("Buenas noches")
    expect(saludoDe(12)).toBe("Buen mediodía")
  })

  it("a las 3 de la madrugada NO dice buenos días", () => {
    // Es el caso que más chirría: el vet de guardia a las 3am leyendo "Buenos días".
    expect(saludoDe(3)).not.toMatch(/días/i)
  })
})

describe("saludoCompleto", () => {
  it("usa sólo el nombre de pila", () => {
    expect(saludoCompleto(9, "María Fernanda Restrepo")).toBe("Buenos días, María")
  })

  it("sin nombre no deja una coma colgando", () => {
    expect(saludoCompleto(9, null)).toBe("Buenos días")
    expect(saludoCompleto(9, "   ")).toBe("Buenos días")
  })
})

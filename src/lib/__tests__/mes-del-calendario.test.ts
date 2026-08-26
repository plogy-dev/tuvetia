/**
 * La grilla del mini calendario.
 *
 * Es aritmética de fechas, que es donde este repositorio ya se cortó dos veces: `new Date("...")`
 * se parsea en UTC y retrocede un día al formatear en Bogotá, y `new Date(2026, 1, 30)` rueda sola
 * a marzo sin avisar. Un mini calendario que se equivoca en un día manda al vet a mirar la agenda
 * de otro día creyendo que es la de hoy.
 */
import { describe, expect, it } from "vitest"

import {
  fechaDesdeISO,
  grillaDelMes,
  isoEnBogota,
  mesVecino,
  nombreDelMes,
} from "@/lib/agenda/mes"

describe("la grilla", () => {
  it("siempre trae 42 días, entren en cinco semanas o en seis", () => {
    // Con filas variables el panel cambia de alto al pasar de mes y todo lo de abajo salta — justo
    // mientras alguien apunta al botón de siguiente.
    for (const mes of ["2026-02-01", "2026-08-01", "2026-11-01", "2027-02-01"]) {
      expect(grillaDelMes(mes)).toHaveLength(42)
    }
  })

  it("empieza en LUNES", () => {
    // `getUTCDay()` da domingo = 0; usarlo tal cual corre la grilla un día entero.
    const g = grillaDelMes("2026-08-01")
    // El 1 de agosto de 2026 es sábado, así que la grilla arranca el lunes 27 de julio.
    expect(g[0].iso).toBe("2026-07-27")
  })

  it("marca cuáles son del mes y cuáles son relleno", () => {
    const g = grillaDelMes("2026-08-01")
    expect(g[0].delMes).toBe(false) // 27 de julio
    expect(g.find((d) => d.iso === "2026-08-01")?.delMes).toBe(true)
    expect(g.find((d) => d.iso === "2026-09-01")?.delMes).toBe(false)
  })

  it("los días son correlativos, sin saltos ni repetidos", () => {
    const g = grillaDelMes("2026-02-01")
    for (let i = 1; i < g.length; i++) {
      const anterior = Date.parse(`${g[i - 1].iso}T00:00:00Z`)
      const actual = Date.parse(`${g[i].iso}T00:00:00Z`)
      expect(actual - anterior).toBe(86_400_000)
    }
  })

  it("febrero de un año bisiesto tiene sus 29", () => {
    const dias = grillaDelMes("2028-02-01").filter((d) => d.delMes)
    expect(dias).toHaveLength(29)
    expect(dias[dias.length - 1].iso).toBe("2028-02-29")
  })

  it("una fecha ilegible devuelve vacío en vez de una grilla inventada", () => {
    expect(grillaDelMes("basura")).toEqual([])
  })
})

describe("navegación entre meses", () => {
  it("avanza y retrocede", () => {
    expect(mesVecino("2026-08-01", 1)).toBe("2026-09-01")
    expect(mesVecino("2026-08-01", -1)).toBe("2026-07-01")
  })

  it("cruza el año en los dos sentidos", () => {
    // Es donde aparece el diciembre que salta a enero del MISMO año cuando se hace a mano.
    expect(mesVecino("2026-12-01", 1)).toBe("2027-01-01")
    expect(mesVecino("2026-01-01", -1)).toBe("2025-12-01")
  })

  it("desde cualquier día del mes, no sólo desde el primero", () => {
    expect(mesVecino("2026-08-26", 1)).toBe("2026-09-01")
  })
})

describe("el nombre del mes", () => {
  it("va capitalizado y con el año", () => {
    expect(nombreDelMes("2026-08-01")).toBe("Agosto 2026")
    expect(nombreDelMes("2026-12-15")).toBe("Diciembre 2026")
  })

  it("no inventa un mes con un número fuera de rango", () => {
    expect(nombreDelMes("2026-13-01")).toBe("")
    expect(nombreDelMes("basura")).toBe("")
  })
})

describe("ida y vuelta con Date", () => {
  it("un ISO vuelve al mismo ISO", () => {
    for (const iso of ["2026-01-01", "2026-08-26", "2026-12-31"]) {
      expect(isoEnBogota(fechaDesdeISO(iso))).toBe(iso)
    }
  })

  it("se ancla al MEDIODÍA y no a la medianoche", () => {
    // Medianoche en un huso a la izquierda de UTC cae en el día anterior: el calendario saltaría un
    // día para atrás en cuanto alguien lo abra desde otra zona horaria.
    expect(fechaDesdeISO("2026-08-26").getHours()).toBe(12)
  })
})

/**
 * Un rato, dicho como lo diría una persona.
 *
 * Lo que se fija acá es que el caso grande no vuelva a salir en minutos crudos: «600 minutos
 * libres» es una cifra que nadie lee de un vistazo, y aparece justo cuando la clínica está vacía.
 */
import { describe, expect, it } from "vitest"

import { duracionLegible } from "@/lib/agenda/duracion"

describe("por debajo de la hora", () => {
  it("va en minutos", () => {
    expect(duracionLegible(40)).toBe("40 minutos")
    expect(duracionLegible(59)).toBe("59 minutos")
  })

  it("uno solo va en singular", () => {
    expect(duracionLegible(1)).toBe("1 minuto")
  })
})

describe("horas exactas", () => {
  it("no se dicen en minutos", () => {
    // El defecto de origen: la jornada entera salía como «600 minutos libres».
    expect(duracionLegible(600)).toBe("10 horas")
    expect(duracionLegible(120)).toBe("2 horas")
  })

  it("una sola va en singular", () => {
    expect(duracionLegible(60)).toBe("1 hora")
  })
})

describe("con resto", () => {
  it("dice las dos unidades, abreviadas", () => {
    // Abreviado porque esto vive en una linea angosta, al lado de la hora y de un boton.
    expect(duracionLegible(90)).toBe("1 h 30 min")
    expect(duracionLegible(185)).toBe("3 h 5 min")
  })

  it("NO redondea el resto hacia arriba", () => {
    // «1 h 50 min» dicho como «2 horas» es media hora de mas en una agenda, y este texto se usa
    // para ofrecerle un turno a un titular.
    expect(duracionLegible(110)).toBe("1 h 50 min")
  })
})

describe("los bordes", () => {
  it("cero se dice, no se rompe", () => {
    expect(duracionLegible(0)).toBe("0 minutos")
  })

  it("un negativo no imprime un signo menos", () => {
    expect(duracionLegible(-30)).toBe("0 minutos")
  })

  it("una cifra ilegible devuelve una raya en vez de NaN", () => {
    expect(duracionLegible(Number.NaN)).toBe("—")
    expect(duracionLegible(Number.POSITIVE_INFINITY)).toBe("—")
  })

  it("los decimales se redondean al minuto", () => {
    expect(duracionLegible(40.4)).toBe("40 minutos")
    expect(duracionLegible(59.6)).toBe("1 hora")
  })
})

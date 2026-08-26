/**
 * El formateo de los campos de dinero.
 *
 * Lo que se fija acá son los ESTADOS INTERMEDIOS, que es donde este tipo de campo se rompe: nadie
 * escribe "50000" de una vez — teclea dígito a dígito, borra en el medio, pega desde otro lado. En
 * cada uno de esos pasos el campo tiene que seguir siendo escribible.
 */
import { describe, expect, it } from "vitest"

import {
  agruparMiles,
  formatearMientrasEscribe,
  pesosDesdeTexto,
  pesosLegibles,
  textoDesdePesos,
} from "@/lib/moneda"

describe("mientras se escribe", () => {
  it("agrupa de a tres con punto, que es el separador de Colombia", () => {
    expect(formatearMientrasEscribe("50000")).toBe("50.000")
    expect(formatearMientrasEscribe("1234567")).toBe("1.234.567")
  })

  it("va agrupando dígito a dígito sin estorbar", () => {
    // El recorrido real de alguien tecleando cincuenta mil.
    expect(["5", "50", "500", "5000", "50000"].map(formatearMientrasEscribe)).toEqual([
      "5",
      "50",
      "500",
      "5.000",
      "50.000",
    ])
  })

  it("vacío se queda vacío", () => {
    // Convertirlo en "0" es la peor forma de ayudar: el vet borra para escribir otro precio y el
    // campo le deja un cero que queda guardado si se distrae.
    expect(formatearMientrasEscribe("")).toBe("")
    expect(formatearMientrasEscribe("abc")).toBe("")
  })

  it("aguanta que le peguen un valor ya formateado o con símbolos", () => {
    expect(formatearMientrasEscribe("$ 50.000")).toBe("50.000")
    expect(formatearMientrasEscribe("50,000")).toBe("50.000")
    expect(formatearMientrasEscribe("COP 1.200")).toBe("1.200")
  })

  it("saca los ceros a la izquierda pero respeta el cero solo", () => {
    // `0` es un precio legítimo —un servicio sin cargo— y borrárselo mientras escribe sería
    // pelearle al teclado.
    expect(formatearMientrasEscribe("007")).toBe("7")
    expect(formatearMientrasEscribe("0")).toBe("0")
  })

  it("nunca devuelve NaN", () => {
    // Es lo que hacía `Intl.NumberFormat` sobre un campo a medio escribir: escupía "NaN" en la cara
    // de alguien que sólo apretó backspace.
    for (const raro of ["", "-", ".", "..", "-.", "e", "1e5"]) {
      expect(formatearMientrasEscribe(raro)).not.toContain("NaN")
    }
  })
})

describe("lo que se guarda", () => {
  it("devuelve pesos, no centavos", () => {
    expect(pesosDesdeTexto("50.000")).toBe(50000)
    expect(pesosDesdeTexto("1.234.567")).toBe(1234567)
  })

  it("distingue vacío de cero", () => {
    // En el onboarding, un servicio sin precio NO se crea y uno en `0` es sin cargo. Colapsarlos
    // crearía media docena de servicios gratis que nadie pidió.
    expect(pesosDesdeTexto("")).toBeNull()
    expect(pesosDesdeTexto("   ")).toBeNull()
    expect(pesosDesdeTexto("0")).toBe(0)
  })

  it("rechaza lo que no cabe en un entero seguro en vez de guardar basura", () => {
    expect(pesosDesdeTexto("9".repeat(20))).toBeNull()
  })
})

describe("ida y vuelta", () => {
  it("sembrar un formulario y volver a leerlo da el mismo número", () => {
    for (const pesos of [0, 7, 999, 1000, 50000, 1234567]) {
      expect(pesosDesdeTexto(textoDesdePesos(pesos))).toBe(pesos)
    }
  })

  it("sin valor, el campo arranca vacío", () => {
    expect(textoDesdePesos(null)).toBe("")
    expect(textoDesdePesos(undefined)).toBe("")
    expect(textoDesdePesos(NaN)).toBe("")
  })
})

describe("para mostrar", () => {
  it("lleva símbolo y separador", () => {
    expect(pesosLegibles(50000)).toBe("$ 50.000")
    expect(pesosLegibles(0)).toBe("$ 0")
  })

  it("sin valor no inventa un cero", () => {
    // Un precio sin cargar y un precio en cero son cosas distintas, y en una tabla se confunden.
    expect(pesosLegibles(null)).toBe("—")
    expect(pesosLegibles(undefined)).toBe("—")
  })
})

describe("agruparMiles", () => {
  it("no toca lo que no llega a mil", () => {
    expect(agruparMiles("999")).toBe("999")
    expect(agruparMiles("1000")).toBe("1.000")
  })
})

/**
 * Dónde dejó el vet el notch.
 *
 * LO QUE ESTOS TESTS PROTEGEN es que el notch no se pueda perder. Es la ventanita que avisa que el
 * micrófono está abierto: si queda fuera de la pantalla, el vet está grabando sin nada que se lo
 * recuerde y sin forma de recuperar el indicador salvo limpiar el navegador.
 *
 * Hay dos maneras de perderlo y las dos están cubiertas acá:
 *
 *   · SOLTARLO AFUERA — se acota al soltar.
 *   · GUARDARLO EN UNA VENTANA Y ABRIR OTRA MÁS CHICA — se vuelve a acotar al leer, que es la parte
 *     que parece de más y es la que realmente rescata.
 *
 * Y un tercero, más callado: un `NaN` guardado envenena el `transform` de CSS y el notch deja de
 * pintarse en ningún lado. Por eso la lectura valida los números en vez de confiar en el JSON.
 */

import { describe, expect, it } from "vitest"

import {
  CENTRADO,
  acotar,
  estaCentrado,
  leerDesplazamiento,
  valorAGuardar,
} from "@/lib/athos/notch-movido"

describe("leer lo guardado", () => {
  it("devuelve el desplazamiento cuando el crudo es válido", () => {
    expect(leerDesplazamiento('{"x":-120,"y":40}')).toEqual({ x: -120, y: 40 })
  })

  it("sin nada guardado, centrado", () => {
    expect(leerDesplazamiento(null)).toEqual(CENTRADO)
    expect(leerDesplazamiento(undefined)).toEqual(CENTRADO)
    expect(leerDesplazamiento("")).toEqual(CENTRADO)
  })

  it("con JSON roto, centrado en vez de reventar", () => {
    expect(leerDesplazamiento("{x:")).toEqual(CENTRADO)
    expect(leerDesplazamiento("null")).toEqual(CENTRADO)
    expect(leerDesplazamiento('"movido"')).toEqual(CENTRADO)
  })

  // De una versión anterior del valor, o de otra pestaña que guardó otra cosa.
  it("con una forma que no es la esperada, centrado", () => {
    expect(leerDesplazamiento('{"left":10,"top":20}')).toEqual(CENTRADO)
    expect(leerDesplazamiento('{"x":"10","y":20}')).toEqual(CENTRADO)
  })

  // EL SILENCIOSO. `translate(NaNpx, …)` no es un error: es una regla de CSS inválida, así que el
  // navegador la descarta y el notch aparece donde no va — o no aparece.
  it("un NaN o un Infinity guardado NO llega al transform", () => {
    expect(leerDesplazamiento('{"x":null,"y":0}')).toEqual(CENTRADO)
    expect(leerDesplazamiento(`{"x":${JSON.stringify(Number.MAX_VALUE)}e400,"y":0}`)).toEqual(CENTRADO)
  })

  it("lo que se guarda se vuelve a leer igual", () => {
    expect(leerDesplazamiento(valorAGuardar({ x: -33, y: 77 }))).toEqual({ x: -33, y: 77 })
  })

  // Sub-pixeles del arrastre: guardarlos alarga el valor sin cambiar nada de lo que se ve.
  it("se guarda redondeado", () => {
    expect(valorAGuardar({ x: 12.4, y: -0.2 })).toBe('{"x":12,"y":0}')
  })
})

describe("acotar al área que hay", () => {
  const LIMITES = { x: 200, y: 300 }

  it("lo que ya cabe no se toca", () => {
    expect(acotar({ x: 50, y: 100 }, LIMITES)).toEqual({ x: 50, y: 100 })
  })

  it("el horizontal es simétrico: se puede a los dos lados", () => {
    expect(acotar({ x: 999, y: 0 }, LIMITES)).toEqual({ x: 200, y: 0 })
    expect(acotar({ x: -999, y: 0 }, LIMITES)).toEqual({ x: -200, y: 0 })
  })

  // Hacia arriba está la cabecera: meterlo debajo de ella es esconderlo.
  it("el vertical sólo baja, nunca sube de su sitio", () => {
    expect(acotar({ x: 0, y: -80 }, LIMITES)).toEqual({ x: 0, y: 0 })
    expect(acotar({ x: 0, y: 999 }, LIMITES)).toEqual({ x: 0, y: 300 })
  })

  // EL RESCATE: guardado en una ventana ancha, abierto en una angosta.
  it("uno que quedó afuera vuelve adentro", () => {
    expect(acotar({ x: 600, y: 500 }, { x: 120, y: 90 })).toEqual({ x: 120, y: 90 })
  })

  // Un área más chica que el propio notch. Sin el `Math.max(0, …)` el tope sería negativo y el
  // recorte invertiría el eje, mandándolo justo para el lado contrario.
  it("sin espacio de sobra, queda centrado y no invertido", () => {
    expect(acotar({ x: 40, y: 40 }, { x: -30, y: -30 })).toEqual({ x: 0, y: 0 })
  })
})

describe("volver al centro", () => {
  it("reconoce el sitio de siempre", () => {
    expect(estaCentrado(CENTRADO)).toBe(true)
    expect(estaCentrado({ x: 0, y: 0 })).toBe(true)
  })

  // De esto depende que el botón de "volver al centro" no aparezca cuando no hace nada.
  it("cualquier corrimiento cuenta, por chico que sea", () => {
    expect(estaCentrado({ x: 1, y: 0 })).toBe(false)
    expect(estaCentrado({ x: 0, y: 1 })).toBe(false)
  })
})

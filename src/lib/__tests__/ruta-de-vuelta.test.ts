/**
 * El saneado de la ruta de vuelta del consentimiento de calendario.
 *
 * Es una guarda contra redirección abierta, así que lo que importa acá no son los casos que
 * funcionan sino los que NO tienen que pasar: la cadena llega del navegador y termina en un
 * redirect al que se llega inmediatamente después de autorizar el acceso al calendario.
 */
import { describe, expect, it } from "vitest"

import { rutaDeVuelta, VUELTA_POR_DEFECTO } from "@/lib/ruta-de-vuelta"

describe("rutas que se aceptan", () => {
  it("el dashboard y sus subcaminos", () => {
    expect(rutaDeVuelta("/dashboard")).toBe("/dashboard")
    expect(rutaDeVuelta("/dashboard/calendario")).toBe("/dashboard/calendario")
    expect(rutaDeVuelta("/dashboard/conexiones")).toBe("/dashboard/conexiones")
  })
})

describe("lo que NO puede pasar", () => {
  it("un dominio ajeno, escrito de las tres formas", () => {
    // `//otro.com` es lo que más fácil se cuela: empieza con barra, así que un chequeo de
    // "¿es relativa?" hecho con `startsWith("/")` lo dejaría pasar. El navegador lo lee como
    // protocolo relativo, o sea otro dominio.
    for (const hostil of [
      "https://sitio-ajeno.com",
      "//sitio-ajeno.com",
      "http://localhost:3000/dashboard",
      "/\\sitio-ajeno.com",
    ]) {
      expect(rutaDeVuelta(hostil)).toBe(VUELTA_POR_DEFECTO)
    }
  })

  it("salirse del dashboard por arriba", () => {
    expect(rutaDeVuelta("/admin")).toBe(VUELTA_POR_DEFECTO)
    expect(rutaDeVuelta("/dashboard/../admin")).toBe(VUELTA_POR_DEFECTO)
  })

  it("arrastrar query o fragmento", () => {
    // El `?calendario=conectado` lo pone quien llama. Dejar pasar el resto sería dejar pasar otro
    // `?next=` colgado del final.
    expect(rutaDeVuelta("/dashboard/calendario?next=https://sitio-ajeno.com")).toBe(VUELTA_POR_DEFECTO)
    expect(rutaDeVuelta("/dashboard#@sitio-ajeno.com")).toBe(VUELTA_POR_DEFECTO)
  })

  it("cualquier cosa que no sea una cadena", () => {
    for (const raro of [null, undefined, 42, {}, [], true]) {
      expect(rutaDeVuelta(raro)).toBe(VUELTA_POR_DEFECTO)
    }
  })
})

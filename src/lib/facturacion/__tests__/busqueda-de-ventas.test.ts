/**
 * El buscador del libro de ventas no puede escribir la consulta.
 *
 * El término termina dentro de un `.or()` de PostgREST, que no recibe parámetros sino una CADENA
 * que se parsea como gramática de filtros. Coma, paréntesis y punto tienen significado ahí: un
 * término que los conserve deja de ser texto a buscar y pasa a ser sintaxis.
 *
 * No es SQL —PostgREST sigue parametrizando contra Postgres—, pero alcanza para leer filas que el
 * filtro de la clínica pretendía excluir. En una lista de facturas eso es exactamente lo que no
 * puede pasar.
 */
import { describe, expect, it } from "vitest"

import { terminoBuscable } from "@/lib/facturacion/busqueda-de-ventas"

describe("terminoBuscable", () => {
  it("deja pasar lo que de verdad se busca", () => {
    // Un número de documento y un nombre con tilde y con eñe: es el 90 % de los casos.
    expect(terminoBuscable("SETP-1024")).toBe("SETP-1024")
    expect(terminoBuscable("María Peña")).toBe("María Peña")
    expect(terminoBuscable("Clínica 24.7")).toBe("Clínica 24.7")
  })

  it("SE LLEVA LA COMA, que abriría otra condición", () => {
    // `a,clinic_id.neq.x` serían DOS filtros unidos por OR, y el segundo no lo escribimos nosotros.
    // El guion bajo también cae, y está bien: en `LIKE` es el comodín de un carácter.
    expect(terminoBuscable("abc,clinic_id.neq.00000000")).toBe("abcclinicid.neq.00000000")
    expect(terminoBuscable("abc,def")).not.toContain(",")
  })

  it("SE LLEVA LOS PARÉNTESIS, que abrirían un grupo o una lista `in.(…)`", () => {
    expect(terminoBuscable("x)*,or(status.eq.EMITIDA")).not.toMatch(/[()]/)
  })

  it("se lleva el asterisco, que en PostgREST es el comodín del ilike", () => {
    // Lo pone el llamador alrededor del término; dentro sólo serviría para ensanchar la búsqueda
    // hasta traerlo todo.
    expect(terminoBuscable("*")).toBe("")
    expect(terminoBuscable("a*b")).toBe("ab")
  })

  it("se lleva comillas y barras", () => {
    expect(terminoBuscable('a"b\'c\\d/e')).toBe("abcde")
  })

  it("recorta a 60 caracteres", () => {
    expect(terminoBuscable("a".repeat(200))).toHaveLength(60)
  })

  it("un término vacío, de espacios, nulo o indefinido da cadena vacía", () => {
    // El llamador decide con esto si aplica el filtro: si devolviera espacios, buscaría por espacio
    // y no encontraría nada, que se lee como «no hay facturas».
    expect(terminoBuscable("   ")).toBe("")
    expect(terminoBuscable("")).toBe("")
    expect(terminoBuscable(undefined)).toBe("")
    expect(terminoBuscable(null)).toBe("")
  })

  it("LO QUE SOBREVIVE NO CONTIENE NINGÚN CARÁCTER CON SIGNIFICADO EN EL FILTRO", () => {
    // La afirmación de fondo, sobre entradas hostiles variadas: pase lo que pase, lo que sale no
    // puede alterar la estructura del `or=(…)`.
    const hostiles = [
      "),or(clinic_id.neq.0",
      "*,payer_id.in.(1,2,3)",
      "a.b,c.d(e)f*g",
      "'; drop table invoices; --",
      "%_\\",
    ]
    for (const h of hostiles) {
      const limpio = terminoBuscable(h)
      expect(limpio, `«${h}» dejó sintaxis`).not.toMatch(/[,()*'"%_\\]/)
    }
  })
})

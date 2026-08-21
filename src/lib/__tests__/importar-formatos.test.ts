/**
 * Las dos piezas que comparten los importadores: dónde empieza la tabla y cómo se decodifica.
 *
 * Salieron del barrido de formatos del 21-ago, que corrió el importador de inventario contra quince
 * planillas distintas. Los dos defectos que encontró no eran de lógica de negocio sino de LECTURA
 * del archivo, y los dos importadores —inventario y pacientes— los tenían igual.
 */

import { describe, expect, it } from "vitest"

import { filaDeCabecera } from "@/lib/importar/cabecera"
import { comoTexto } from "@/lib/importar/texto"

describe("dónde empieza la tabla", () => {
  const reconoce = (c: string) => ["nombre", "precio", "cantidad"].includes(c.trim().toLowerCase())

  it("sin nada raro, la tabla empieza en la fila 0", () => {
    expect(filaDeCabecera([["Nombre", "Precio"], ["X", "10"]], reconoce)).toBe(0)
  })

  // EL CASO QUE ROMPÍA. Con la fila 0 fija, los encabezados reales entraban como datos y las
  // columnas quedaban llamándose `_1`, `_2`: cero columnas mapeadas.
  it("salta una fila de título", () => {
    expect(filaDeCabecera([["INVENTARIO CLÍNICA", "", ""], ["Nombre", "Precio"], ["X", "10"]], reconoce)).toBe(1)
  })

  it("salta título y filas en blanco", () => {
    expect(filaDeCabecera([["Reporte"], [], ["", ""], ["Nombre", "Precio"], ["X", "10"]], reconoce)).toBe(3)
  })

  // Sin reconocedor sólo queda la densidad: un título suele ocupar una celda; una tabla, varias.
  it("sin reconocedor, la primera fila con dos celdas con texto", () => {
    expect(filaDeCabecera([["Solo el título", ""], ["Col A", "Col B"], ["1", "2"]])).toBe(1)
  })

  // ANTE LA DUDA, LA FILA 0 — que es lo que se hacía antes. Este módulo sólo puede mejorar el caso
  // que hoy falla, nunca empeorar el que hoy anda.
  it("si no reconoce nada y nada es denso, cae a la fila 0", () => {
    expect(filaDeCabecera([["algo"], ["otra"]], reconoce)).toBe(0)
    expect(filaDeCabecera([], reconoce)).toBe(0)
  })

  // Una fila de datos no puede reconocer más encabezados que el encabezado; ante empate manda la
  // primera, o una planilla con datos parecidos partiría la tabla al medio.
  it("ante empate gana la primera", () => {
    expect(filaDeCabecera([["Nombre", "Precio"], ["Nombre", "Precio"]], reconoce)).toBe(0)
  })

  // Un encabezado en la fila 30 no es "una tabla con título arriba": es otra cosa, y buscarlo tan
  // abajo encontraría falsos positivos entre los datos.
  it("no busca indefinidamente hacia abajo", () => {
    const filas = [...Array(20).fill(["basura"]), ["Nombre", "Precio"]]
    expect(filaDeCabecera(filas, reconoce)).toBe(0)
  })
})

describe("cómo se decodifica el CSV", () => {
  const CON_TILDE = "Categoría;Ubicación\nMedicamento;Bodega\n"

  it("UTF-8 se lee tal cual", () => {
    expect(comoTexto(Buffer.from(CON_TILDE, "utf-8"))).toBe(CON_TILDE)
  })

  // EL CASO DE VERDAD: Excel en Windows guarda "CSV" en Windows-1252, no en UTF-8. Antes esto daba
  // "Categor�a", que no mapea con ninguna regla — y la columna con tilde no entraba.
  it("Windows-1252 se detecta y se decodifica bien", () => {
    expect(comoTexto(Buffer.from(CON_TILDE, "latin1"))).toBe(CON_TILDE)
  })

  it("el BOM no se queda pegado al primer encabezado", () => {
    const conBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(CON_TILDE, "utf-8")])
    expect(comoTexto(conBom)).toBe(CON_TILDE)
    expect(comoTexto(conBom).startsWith("Categoría")).toBe(true)
  })

  // El orden de las pruebas no es simétrico: en Windows-1252 CUALQUIER byte es válido, así que
  // probarlo primero aceptaría siempre y jamás se detectaría UTF-8. Este caso lo fija.
  it("un UTF-8 con caracteres altos NO se confunde con Windows-1252", () => {
    const emoji = "Nombre,Señal\nMichifú,✅\n"
    expect(comoTexto(Buffer.from(emoji, "utf-8"))).toBe(emoji)
  })

  it("acepta Uint8Array además de Buffer", () => {
    expect(comoTexto(new Uint8Array(Buffer.from(CON_TILDE, "utf-8")))).toBe(CON_TILDE)
  })
})

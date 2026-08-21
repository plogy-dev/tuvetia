/**
 * El barrido de formatos del importador de inventario.
 *
 * POR QUÉ EXISTE. David, 19-ago: *"cuando le das tablas de Excel a veces las columnas las está
 * intercambiando y las está mezclando… corré varias, porque a mí me ha pasado que subo dos bien y
 * el tercero baila"*. Los tests que había cubrían `toNumber`, `proposeMapping` y `validateRows`,
 * o sea la lógica **después** de leer el archivo — **nadie probaba `parseInventoryFile`**. El
 * "tercero" que bailaba nunca podía salir en la suite, porque lo que fallaba era la lectura.
 *
 * ── LO QUE ENCONTRÓ EL BARRIDO (21-ago) ─────────────────────────────────────────────────────────
 *
 * Quince formatos. Los que uno sospecharía primero —punto y coma, tabulador, BOM, CRLF, .xls
 * viejo— andaban todos. Los tres que fallaban no eran esos:
 *
 *   1. CSV EN WINDOWS-1252, que es lo que Excel en Windows guarda por defecto. `toString("utf-8")`
 *      dejaba "Categor�a" y esa columna no mapeaba: 4 de 5.
 *   2. XLSX CON FILA DE TÍTULO ARRIBA. Catastrófico: 0 de 5 columnas mapeadas, los encabezados
 *      reales entrando como datos y las columnas llamándose `_1`, `_2`. **Éste es el tercero que
 *      bailaba** — el que traía título.
 *   3. FECHAS COMO SERIAL DE EXCEL: un vencimiento llegaba `46401.79` en vez de una fecha.
 *
 * La forma del test es a propósito una TABLA: agregar un formato que un cliente reportó es agregar
 * una fila, no escribir un test nuevo. Es lo que hace que "corré varias" sea barato de repetir.
 */

import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"

import { parseInventoryFile, proposeMapping } from "../parse"

const CABECERAS = ["Nombre", "Categoría", "Precio de venta", "Existencia", "IVA"]
const FILA = ["Amoxicilina 500mg", "Medicamento", "85.000", "12", "19"]

function xlsxDe(aoa: unknown[][], bookType: XLSX.BookType = "xlsx"): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Hoja1")
  return XLSX.write(wb, { type: "buffer", bookType }) as Buffer
}

const conSeparador = (sep: string) => `${CABECERAS.join(sep)}\n${FILA.join(sep)}\n`

/** Cada formato en que un cliente puede mandar la misma planilla. Todos tienen que dar lo mismo. */
const FORMATOS: { nombre: string; archivo: string; buf: Buffer }[] = [
  { nombre: "xlsx", archivo: "inv.xlsx", buf: xlsxDe([CABECERAS, FILA]) },
  { nombre: "xls (binario viejo)", archivo: "inv.xls", buf: xlsxDe([CABECERAS, FILA], "biff8") },
  { nombre: "csv utf-8", archivo: "inv.csv", buf: Buffer.from(conSeparador(","), "utf-8") },
  {
    nombre: "csv utf-8 con BOM",
    archivo: "inv.csv",
    buf: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(conSeparador(","), "utf-8")]),
  },
  // EL CASO DE VERDAD: Excel en Windows guarda "CSV" en Windows-1252, no en UTF-8.
  {
    nombre: "csv windows-1252 (Excel de Windows)",
    archivo: "inv.csv",
    buf: Buffer.from(conSeparador(","), "latin1"),
  },
  { nombre: "csv con punto y coma (Excel ES)", archivo: "inv.csv", buf: Buffer.from(conSeparador(";"), "utf-8") },
  { nombre: "csv tabulado", archivo: "inv.csv", buf: Buffer.from(conSeparador("\t"), "utf-8") },
  {
    nombre: "csv con saltos CRLF",
    archivo: "inv.csv",
    buf: Buffer.from(conSeparador(",").replace(/\n/g, "\r\n"), "utf-8"),
  },
  // EL TERCERO QUE BAILABA: una fila de título encima de la tabla.
  {
    nombre: "xlsx con fila de título encima",
    archivo: "inv.xlsx",
    buf: xlsxDe([["INVENTARIO CLÍNICA VETERINARIA", "", "", "", ""], CABECERAS, FILA]),
  },
  {
    nombre: "xlsx con título y una fila en blanco encima",
    archivo: "inv.xlsx",
    buf: xlsxDe([["Reporte de inventario"], [], CABECERAS, FILA]),
  },
  {
    nombre: "csv con fila de título encima",
    archivo: "inv.csv",
    buf: Buffer.from(`Reporte de inventario\n${conSeparador(",")}`, "utf-8"),
  },
]

describe("el mismo inventario, en todos los formatos", () => {
  it.each(FORMATOS)("$nombre se lee igual", ({ archivo, buf }) => {
    const { columns, rows } = parseInventoryFile(buf, archivo)

    expect(columns).toEqual(CABECERAS)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(Object.fromEntries(CABECERAS.map((c, i) => [c, FILA[i]])))
  })

  // Leer las columnas no alcanza: lo que rompe el import es que no MAPEEN. Un acento corrupto deja
  // la columna con un nombre que ninguna regla reconoce, y esa columna simplemente no entra.
  it.each(FORMATOS)("$nombre mapea las cinco columnas", ({ archivo, buf }) => {
    const { columns } = parseInventoryFile(buf, archivo)
    const mapeadas = Object.values(proposeMapping(columns)).filter(Boolean)
    expect(mapeadas).toHaveLength(5)
  })
})

describe("celdas que no son texto", () => {
  // Un xlsx real guarda la fecha como SERIAL con formato, no como texto. 46402 = 15-ene-2027.
  it("una fecha llega como fecha, no como el serial de Excel", () => {
    const ws: XLSX.WorkSheet = {
      "!ref": "A1:B2",
      A1: { t: "s", v: "Nombre" },
      B1: { t: "s", v: "Vence" },
      A2: { t: "s", v: "Amoxicilina" },
      B2: { t: "n", v: 46402, z: "yyyy-mm-dd" },
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Hoja1")
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer

    const { rows } = parseInventoryFile(buf, "inv.xlsx")
    expect(rows[0].Vence).toBe("2027-01-15")
  })

  it("un número nativo llega sin notación rara", () => {
    const { rows } = parseInventoryFile(xlsxDe([["Nombre", "Precio"], ["X", 85000]]), "inv.xlsx")
    expect(rows[0].Precio).toBe("85000")
  })
})

describe("encabezados que se pisan", () => {
  // Dos columnas con el mismo nombre colapsaban en una: los datos de la segunda aparecían bajo la
  // primera. Es la otra mitad de "mezcla las columnas".
  it("dos columnas con el mismo nombre no se fusionan", () => {
    const { columns, rows } = parseInventoryFile(
      xlsxDe([["Nombre", "Precio", "Precio"], ["X", "10", "20"]]),
      "inv.xlsx",
    )
    expect(columns).toEqual(["Nombre", "Precio", "Precio (2)"])
    expect(rows[0]).toEqual({ Nombre: "X", Precio: "10", "Precio (2)": "20" })
  })

  it("una columna sin encabezado recibe un nombre y no una clave vacía", () => {
    const { columns } = parseInventoryFile(xlsxDe([["Nombre", "", "Precio"], ["X", "?", "10"]]), "inv.xlsx")
    expect(columns).toEqual(["Nombre", "Columna 2", "Precio"])
  })

  it("los espacios alrededor del encabezado no impiden el mapeo", () => {
    const { columns } = parseInventoryFile(
      xlsxDe([["  Nombre  ", " Precio de venta "], ["X", "10"]]),
      "inv.xlsx",
    )
    expect(Object.values(proposeMapping(columns)).filter(Boolean)).toHaveLength(2)
  })
})

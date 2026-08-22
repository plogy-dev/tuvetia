/**
 * El inventario bajado a Excel.
 *
 * LO QUE ESTOS TESTS PROTEGEN es que el archivo que la app GENERA sea un archivo que la app sabe
 * LEER. Bajar el inventario, corregirlo en Excel y volver a subirlo es el motivo por el que alguien
 * pide un export; si los encabezados no calzan con `proposeMapping`, lo que sale es una planilla
 * que su propio importador no reconoce — y eso no se nota mirando el archivo, se nota el día que
 * alguien intenta volver a subirlo.
 *
 * Por eso el test central no compara contra una lista de encabezados escrita a mano: hace el
 * VIAJE DE IDA Y VUELTA de verdad, exportando y parseando con el importador real.
 *
 * ⚠️ La vuelta está probada acá pero HOY NO CORRE EN LA APP: `createImportPreview` está
 * deshabilitada a propósito por `xlsx@0.18.5` (prototype pollution + ReDoS, ver ESTADO.md). El
 * contrato se sostiene igual para cuando se reemplace la librería — y mientras tanto este test es
 * lo que impide que el export se aleje del importador sin que nadie se dé cuenta.
 */

import { describe, expect, it } from "vitest"

import {
  ENCABEZADOS,
  filasDeInventario,
  libroDeInventario,
  nombreDelArchivo,
  type ItemExportable,
} from "@/lib/facturacion/export/inventario"
import { parseInventoryFile, proposeMapping } from "@/lib/facturacion/import/parse"

const PRODUCTO: ItemExportable = {
  id: "i1",
  name: "Amoxicilina 500mg",
  item_type: "PRODUCTO",
  sku: "AMX-500",
  category_id: "cat1",
  purchase_unit: "caja",
  use_unit: "comprimido",
  conversion_factor: 20,
  price_cents: 8_500_000,
  cost_cents: 5_000_000,
  tax_rate: 19,
  min_stock: 5,
  supplier: "Droguería Vet",
  location: "Bodega A",
  duration_minutes: null,
  track_stock: true,
}

const SERVICIO: ItemExportable = {
  ...PRODUCTO,
  id: "i2",
  name: "Consulta general",
  item_type: "SERVICIO",
  sku: null,
  category_id: null,
  price_cents: 6_000_000,
  cost_cents: null,
  tax_rate: 0,
  min_stock: null,
  supplier: null,
  location: null,
  duration_minutes: 30,
  track_stock: false,
}

const CONTEXTO = {
  stock: new Map([["i1", 12]]),
  categorias: new Map([["cat1", "Medicamentos"]]),
}

describe("el viaje de ida y vuelta", () => {
  // EL TEST QUE IMPORTA. Si alguien renombra una columna para que "se lea mejor", esto se pone en
  // rojo — que es exactamente lo que tiene que pasar.
  it("lo exportado lo reconoce el importador, columna por columna", () => {
    const buf = libroDeInventario([PRODUCTO, SERVICIO], CONTEXTO)
    const { columns } = parseInventoryFile(buf, "Inventario.xlsx")

    const mapeadas = Object.values(proposeMapping(columns)).filter(Boolean)
    expect(mapeadas).toHaveLength(ENCABEZADOS.length)
  })

  it("los valores vuelven como se exportaron", () => {
    const buf = libroDeInventario([PRODUCTO], CONTEXTO)
    const { rows } = parseInventoryFile(buf, "Inventario.xlsx")

    expect(rows[0]).toMatchObject({
      Nombre: "Amoxicilina 500mg",
      Tipo: "PRODUCTO",
      Categoría: "Medicamentos",
      SKU: "AMX-500",
      "Precio de venta": "85000",
      Costo: "50000",
      IVA: "19",
      Existencia: "12",
      "Unidad de compra": "caja",
      "Unidad de uso": "comprimido",
      "Factor de conversión": "20",
      Proveedor: "Droguería Vet",
      Ubicación: "Bodega A",
    })
  })

  it("una fila por ítem, más la de encabezados", () => {
    expect(filasDeInventario([PRODUCTO, SERVICIO], CONTEXTO)).toHaveLength(3)
  })
})

describe("cómo se escriben los valores", () => {
  const fila = (item: ItemExportable) => {
    const [encabezados, valores] = filasDeInventario([item], CONTEXTO)
    return Object.fromEntries((encabezados as string[]).map((h, i) => [h, (valores as unknown[])[i]]))
  }

  // La base guarda centavos. 8.500.000 en una planilla no se lee como un error: se lee como ocho
  // millones y medio.
  it("los precios salen en pesos, no en centavos", () => {
    expect(fila(PRODUCTO)["Precio de venta"]).toBe(85_000)
    expect(fila(PRODUCTO).Costo).toBe(50_000)
  })

  // Una planilla que se puede sumar y ordenar, en vez de una que hay que convertir antes de servir.
  it("los números salen como números, no como texto", () => {
    expect(typeof fila(PRODUCTO)["Precio de venta"]).toBe("number")
    expect(typeof fila(PRODUCTO).Existencia).toBe("number")
    expect(typeof fila(PRODUCTO).IVA).toBe("number")
  })

  // Un servicio no está agotado: es que no se cuenta. Un 0 mostraría quince servicios "sin stock".
  it("un servicio va con la existencia VACÍA, no en cero", () => {
    expect(fila(SERVICIO).Existencia).toBe("")
  })

  it("lo que no está cargado queda vacío y no dice 'null'", () => {
    const f = fila(SERVICIO)
    expect(f.SKU).toBe("")
    expect(f.Costo).toBe("")
    expect(f.Proveedor).toBe("")
    expect(f["Stock mínimo"]).toBe("")
    expect(f.Categoría).toBe("")
  })

  it("la duración del servicio viaja", () => {
    expect(fila(SERVICIO)["Duración (minutos)"]).toBe(30)
  })
})

describe("el nombre del archivo", () => {
  it("lleva la clínica y la fecha", () => {
    expect(nombreDelArchivo("Clínica del Sur", "2026-08-21")).toBe("Inventario-Clinica-del-Sur-2026-08-21.xlsx")
  })

  // Un `/` o un `:` en el nombre de la clínica rompe la descarga en Windows.
  it("saca lo que Windows no acepta en un nombre de archivo", () => {
    expect(nombreDelArchivo("Vet 24/7: Norte", "2026-08-21")).toBe("Inventario-Vet-24-7-Norte-2026-08-21.xlsx")
  })

  it("sin nombre de clínica sigue siendo un nombre válido", () => {
    expect(nombreDelArchivo(null, "2026-08-21")).toBe("Inventario-2026-08-21.xlsx")
  })
})

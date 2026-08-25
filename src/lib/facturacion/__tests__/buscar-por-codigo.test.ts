/**
 * Buscar un producto por lo que escupió el lector de código de barras.
 *
 * ── LO QUE ESTE TEST EXISTE PARA IMPEDIR ──────────────────────────────────────────────────────
 *
 * La forma ingenua —`items.find(i => i.barcode === codigo)`— tiene un agujero que sólo aparece en
 * el mostrador: con un código VACÍO (un Enter suelto, que pasa) y un catálogo donde casi ningún
 * ítem tiene código de barras, `(i.barcode ?? "") === ""` da verdadero para el primer ítem sin
 * código. Un Enter de más agregaría un producto al azar a la cuenta de un cliente.
 *
 * Lo demás que se fija: que la coincidencia sea EXACTA —parcial facturaría otro producto— y que dos
 * ítems con el mismo código no elijan uno en silencio.
 */
import { describe, expect, it } from "vitest"

import { buscarPorCodigo } from "@/lib/facturacion/buscar-por-codigo"

const CATALOGO = [
  { id: "a", barcode: "7702001001234", sku: "VAC-01" },
  { id: "b", barcode: null, sku: "CONS-GEN" },
  { id: "c", barcode: "7702001005678", sku: null },
  { id: "d", barcode: null, sku: null },
]

describe("lo normal", () => {
  it("encuentra por código de barras", () => {
    const r = buscarPorCodigo(CATALOGO, "7702001001234")
    expect(r.tipo).toBe("encontrado")
    expect(r.tipo === "encontrado" && r.item.id).toBe("a")
  })

  it("cae al SKU cuando el ítem no tiene código de barras", () => {
    // Muchas clínicas cargan la referencia del proveedor en el SKU y nunca llenan `barcode`.
    const r = buscarPorCodigo(CATALOGO, "CONS-GEN")
    expect(r.tipo === "encontrado" && r.item.id).toBe("b")
  })

  it("el código de barras MANDA sobre el SKU", () => {
    // Si un ítem tiene como SKU el código de barras de otro, gana el que lo lleva en la caja.
    const catalogo = [
      { id: "x", barcode: null, sku: "999" },
      { id: "y", barcode: "999", sku: null },
    ]
    expect(buscarPorCodigo(catalogo, "999")).toEqual({ tipo: "encontrado", item: catalogo[1] })
  })

  it("no le importan espacios ni mayúsculas", () => {
    // Los lectores agregan basura al final, y un SKU escrito a mano puede venir en cualquier caja.
    expect(buscarPorCodigo(CATALOGO, "  7702001001234  ").tipo).toBe("encontrado")
    expect(buscarPorCodigo(CATALOGO, "vac-01").tipo).toBe("encontrado")
  })
})

describe("UN ENTER SUELTO NO AGREGA UN PRODUCTO AL AZAR", () => {
  it("el código vacío no coincide con ningún ítem sin código", () => {
    // ÉSTE es el caso. Con `find(i => i.barcode === codigo)` y un catálogo lleno de `barcode: null`,
    // un Enter de más agregaba el primer ítem sin código a la cuenta de un cliente.
    for (const vacio of ["", "   ", "\n", "\t"]) {
      expect(buscarPorCodigo(CATALOGO, vacio), JSON.stringify(vacio)).toEqual({ tipo: "vacio" })
    }
  })

  it("ni siquiera en un catálogo donde NINGÚN ítem tiene código", () => {
    const sinCodigos = [
      { id: "p", barcode: null, sku: null },
      { id: "q", barcode: null, sku: null },
    ]
    expect(buscarPorCodigo(sinCodigos, "").tipo).toBe("vacio")
    expect(buscarPorCodigo(sinCodigos, "cualquiera").tipo).toBe("sin-resultado")
  })
})

describe("la coincidencia es EXACTA", () => {
  it("un código que es prefijo de otro no lo trae", () => {
    // En una búsqueda escrita, `includes` ayuda. En una venta, factura otro producto.
    expect(buscarPorCodigo(CATALOGO, "770200100").tipo).toBe("sin-resultado")
    expect(buscarPorCodigo(CATALOGO, "7702001001234567").tipo).toBe("sin-resultado")
  })

  it("lo que no está, no está", () => {
    expect(buscarPorCodigo(CATALOGO, "0000000000000").tipo).toBe("sin-resultado")
  })
})

describe("dos productos con el mismo código", () => {
  it("NO elige uno en silencio", () => {
    // Pasa al duplicar un ítem o al copiar uno y olvidar cambiarle el código. Elegir el primero
    // factura el producto equivocado, y no se descubre hasta que el inventario no cuadra.
    const duplicado = [
      { id: "m", barcode: "555", sku: null },
      { id: "n", barcode: "555", sku: null },
    ]
    const r = buscarPorCodigo(duplicado, "555")
    expect(r.tipo).toBe("ambiguo")
    expect(r.tipo === "ambiguo" && r.items).toHaveLength(2)
  })

  it("también si la ambigüedad está en el SKU", () => {
    const duplicado = [
      { id: "m", barcode: null, sku: "REF-9" },
      { id: "n", barcode: null, sku: "ref-9" },
    ]
    expect(buscarPorCodigo(duplicado, "REF-9").tipo).toBe("ambiguo")
  })
})

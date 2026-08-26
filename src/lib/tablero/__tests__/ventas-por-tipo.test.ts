/**
 * La dona de ventas: que el color siga al TIPO y que la plata no se pierda en silencio.
 */
import { describe, expect, it } from "vitest"

import { ventasPorTipo } from "@/lib/tablero/ventas-por-tipo"

describe("ventasPorTipo", () => {
  it("agrupa por tipo y suma", () => {
    const r = ventasPorTipo([
      { total_cents: 100, item_type: "SERVICIO" },
      { total_cents: 200, item_type: "SERVICIO" },
      { total_cents: 50, item_type: "PRODUCTO" },
    ])
    expect(r.map((d) => [d.tipo, d.totalCents])).toEqual([
      ["SERVICIO", 300],
      ["PRODUCTO", 50],
    ])
  })

  it("el color va con el tipo, no con el puesto", () => {
    // «Servicios» es menta venda lo que venda. Si el color siguiera al ranking, la dona cambiaría
    // de colores cada mes y dejaría de leerse de un vistazo — la regla de oro de las paletas
    // categóricas.
    const soloProductos = ventasPorTipo([{ total_cents: 10, item_type: "PRODUCTO" }])
    const conServicios = ventasPorTipo([
      { total_cents: 99, item_type: "SERVICIO" },
      { total_cents: 10, item_type: "PRODUCTO" },
    ])
    const colorDeProducto = (r: typeof soloProductos) => r.find((d) => d.tipo === "PRODUCTO")?.color
    expect(colorDeProducto(soloProductos)).toBe(colorDeProducto(conServicios))
  })

  it("el orden es el fijo del catálogo de tipos, no el del monto", () => {
    const r = ventasPorTipo([
      { total_cents: 1000, item_type: "INSUMO" },
      { total_cents: 1, item_type: "SERVICIO" },
    ])
    expect(r.map((d) => d.tipo)).toEqual(["SERVICIO", "INSUMO"])
  })

  it("las líneas libres y los tipos desconocidos caen en «Líneas libres», no al vacío", () => {
    // Perder plata de la dona en silencio es peor que rotularla genérico: si el catálogo gana un
    // tipo nuevo mañana, su venta aparece como línea libre hasta que alguien lo agregue acá.
    const r = ventasPorTipo([
      { total_cents: 70, item_type: null },
      { total_cents: 30, item_type: "HOSPITALIZACION" },
    ])
    expect(r).toHaveLength(1)
    expect(r[0].tipo).toBe("OTROS")
    expect(r[0].totalCents).toBe(100)
  })

  it("los tipos sin venta no aparecen — una dona de gajos en cero es ruido", () => {
    expect(ventasPorTipo([])).toEqual([])
  })
})

/**
 * Qué es "una consulta sin facturar".
 *
 * LO QUE ESTOS TESTS PROTEGEN es que haya UNA sola respuesta. La pregunta se contesta en dos
 * lugares —el riel de pendientes y la lista de Ventas— y el riel MANDA a la lista: anuncia
 * "tenés 12 sin facturar" y el vet hace clic esperando ver doce. Cualquier diferencia entre las dos
 * reglas se ve como que la app miente.
 *
 * Ya se separaron una vez: la lista descartaba las facturas ANULADAS y el riel no, así que una
 * consulta cuya única factura se anuló quedaba escondida justo cuando había que volver a emitirla.
 * Se arregló en los dos lados por separado — que es exactamente la forma en que vuelve a romperse.
 */

import { describe, expect, it } from "vitest"

import {
  DIAS_SIN_FACTURAR,
  TOPE_SIN_FACTURAR,
  desdeCuando,
  estaSinFacturar,
  hayMasQueElTope,
  soloSinFacturar,
} from "@/lib/facturacion/sin-facturar"

describe("qué cuenta como facturada", () => {
  it("sin ninguna factura, sigue sin facturar", () => {
    expect(estaSinFacturar([])).toBe(true)
  })

  // El embed de PostgREST llega `null` cuando no hay filas relacionadas: es "sin facturar", no un
  // error que haya que tratar aparte.
  it("el embed nulo es sin facturar, no un error", () => {
    expect(estaSinFacturar(null)).toBe(true)
    expect(estaSinFacturar(undefined)).toBe(true)
  })

  it("con una factura en pie, ya está facturada", () => {
    expect(estaSinFacturar([{ status: "EMITIDA" }])).toBe(false)
  })

  // ANULAR UNA FACTURA DEJA LA CONSULTA OTRA VEZ POR COBRAR. Es la regla que estaba escrita en un
  // lado y no en el otro.
  it("una factura anulada NO cuenta como facturada", () => {
    expect(estaSinFacturar([{ status: "ANULADA" }])).toBe(true)
  })

  it("anulada más emitida sí cuenta: se volvió a emitir", () => {
    expect(estaSinFacturar([{ status: "ANULADA" }, { status: "EMITIDA" }])).toBe(false)
  })

  it("filtra un lote conservando el orden", () => {
    const filas = [
      { id: "a", invoices: [] },
      { id: "b", invoices: [{ status: "EMITIDA" }] },
      { id: "c", invoices: [{ status: "ANULADA" }] },
      { id: "d", invoices: null },
    ]
    expect(soloSinFacturar(filas).map((f) => f.id)).toEqual(["a", "c", "d"])
  })
})

describe("la ventana", () => {
  it("corta 60 días antes del día de Bogotá", () => {
    // 2026-08-22 menos 60 días = 2026-06-23, a las 00:00 de Bogotá (05:00 UTC).
    expect(desdeCuando("2026-08-22")).toBe("2026-06-23T05:00:00.000Z")
  })

  it("el corte es estable dentro del mismo día", () => {
    expect(desdeCuando("2026-08-22")).toBe(desdeCuando("2026-08-22"))
  })

  it("son los días que declara la constante", () => {
    const a = new Date(desdeCuando("2026-08-22")).getTime()
    const b = new Date("2026-08-22T00:00:00-05:00").getTime()
    expect(Math.round((b - a) / 86_400_000)).toBe(DIAS_SIN_FACTURAR)
  })
})

describe("decir la verdad sobre el tope", () => {
  // Cuando se llega al tope no se sabe cuántas hay: se sabe que hay al menos ésas. Es el mismo
  // truncamiento silencioso que ya se corrigió en `getDashboardKpis` y en `getStockMap`.
  it("por debajo del tope el total es exacto", () => {
    expect(hayMasQueElTope(TOPE_SIN_FACTURAR - 1)).toBe(false)
    expect(hayMasQueElTope(0)).toBe(false)
  })

  it("en el tope ya no se sabe: es 'o más'", () => {
    expect(hayMasQueElTope(TOPE_SIN_FACTURAR)).toBe(true)
  })
})

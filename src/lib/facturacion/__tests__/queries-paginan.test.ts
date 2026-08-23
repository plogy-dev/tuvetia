/**
 * Las dos lecturas de `queries.ts` que suman: la plata del mes y las existencias.
 *
 * POR QUÉ ESTE ARCHIVO. `queries.ts` tiene 1017 líneas, es la capa donde vive el dinero, y no tenía
 * **un solo test**. El `domain/` de al lado tiene diecisiete. La diferencia no es casual: el dominio
 * es puro y se prueba solo, y estas funciones hablan con la base — así que probarlas cuesta un
 * cliente falso, y por eso nunca se hizo.
 *
 * ── LO QUE PROTEGEN, Y POR QUÉ NO SE VE HOY ─────────────────────────────────────────────────────
 *
 * Las dos PAGINAN A PASO DE 1000 porque ése es el `max-rows` de PostgREST: pedir más devuelve mil
 * **sin error**. Es el peor modo de falla que existe — no hay excepción, no hay log, sólo una cifra
 * más chica de lo que corresponde. Ya mordió dos veces (`getDashboardKpis` y `getStockMap` llevan
 * el arreglo escrito en sus comentarios), y las dos veces se descubrió mirando, no fallando.
 *
 * Y NO SE VE HOY: ninguna clínica del principal llega a mil facturas ni a mil movimientos. Aparece
 * el día que entre una con volumen real — que es exactamente lo que se está por hacer. Un test es
 * la única forma de que ese día no sea una sorpresa.
 *
 * ── EL CLIENTE FALSO ────────────────────────────────────────────────────────────────────────────
 *
 * Mismo enfoque que `senales/__tests__/consultar.test.ts`: un objeto que responde la cadena de
 * PostgREST y anota los filtros. Sirve el `.range(desde, hasta)` de verdad sobre un arreglo, que es
 * lo único que hace falta para que la paginación se ejercite como en producción.
 */

import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getDashboardKpis, getStockMap } from "@/lib/facturacion/queries"

/** Un filtro aplicado, para poder exigir el aislamiento por clínica. */
type Filtro = { tabla: string; columna: string; valor: unknown }

type Respuestas = Record<string, unknown[]>

function clienteFalso(respuestas: Respuestas, filtros: Filtro[] = []) {
  const cliente = {
    from(tabla: string) {
      let desde = 0
      let hasta = Infinity
      let conteo = false

      const nodo: Record<string, unknown> = {}
      for (const m of ["order", "gte", "gt", "lt", "in", "not", "limit", "neq"]) {
        nodo[m] = () => nodo
      }
      nodo.select = (_cols: string, opts?: { count?: string; head?: boolean }) => {
        conteo = Boolean(opts?.head)
        return nodo
      }
      nodo.eq = (columna: string, valor: unknown) => {
        filtros.push({ tabla, columna, valor })
        return nodo
      }
      nodo.range = (a: number, b: number) => {
        desde = a
        hasta = b
        return nodo
      }
      nodo.then = (resolver: (v: unknown) => unknown) => {
        const todas = respuestas[tabla] ?? []
        // `head: true` no trae filas: sólo el conteo, como PostgREST.
        if (conteo) return resolver({ data: null, count: todas.length, error: null })
        return resolver({ data: todas.slice(desde, hasta + 1), error: null })
      }
      return nodo
    },
  }
  return cliente as unknown as SupabaseClient
}

const CLINICA = "cli-1"
const MES = "2026-08-01T00:00:00.000Z"

const factura = (total: number, pagado: number) => ({
  total_cents: total,
  paid_cents: pagado,
  balance_cents: total - pagado,
})

describe("getDashboardKpis suma toda la plata, no la primera página", () => {
  it("una clínica chica suma bien", async () => {
    const kpis = await getDashboardKpis(
      clienteFalso({ invoices: [factura(100_000, 100_000), factura(50_000, 0)] }),
      CLINICA,
      MES,
    )
    expect(kpis.billedCents).toBe(150_000)
    expect(kpis.collectedCents).toBe(100_000)
    expect(kpis.issuedCount).toBe(2)
  })

  // EL TEST QUE JUSTIFICA EL ARCHIVO. Con 2.500 facturas, una lectura sin paginar devolvería mil y
  // el tablero mostraría el 40% de lo facturado — sin error, sin log, sin nada que mirar.
  it("con 2.500 facturas no se queda en las primeras mil", async () => {
    const muchas = Array.from({ length: 2_500 }, () => factura(1_000, 400))
    const kpis = await getDashboardKpis(clienteFalso({ invoices: muchas }), CLINICA, MES)

    expect(kpis.issuedCount).toBe(2_500)
    expect(kpis.billedCents).toBe(2_500_000)
    expect(kpis.collectedCents).toBe(1_000_000)
  })

  // El borde exacto: 1.000 filas justas. La condición de corte es `filas.length < PAGE`, así que una
  // página llena obliga a pedir la siguiente — y la siguiente tiene que venir vacía sin colgarse.
  it("con exactamente 1.000 no entra en bucle ni pierde la última", async () => {
    const mil = Array.from({ length: 1_000 }, () => factura(2_000, 0))
    const kpis = await getDashboardKpis(clienteFalso({ invoices: mil }), CLINICA, MES)
    expect(kpis.issuedCount).toBe(1_000)
    expect(kpis.billedCents).toBe(2_000_000)
  })

  it("sin facturas, todo en cero y sin reventar", async () => {
    const kpis = await getDashboardKpis(clienteFalso({ invoices: [] }), CLINICA, MES)
    expect(kpis).toMatchObject({ billedCents: 0, collectedCents: 0, issuedCount: 0, openCount: 0 })
  })

  // La cartera abierta se suma en su propio bucle, que también pagina.
  it("la cartera abierta también suma todas las páginas", async () => {
    const muchas = Array.from({ length: 1_500 }, () => factura(3_000, 1_000))
    const kpis = await getDashboardKpis(clienteFalso({ invoices: muchas }), CLINICA, MES)
    expect(kpis.openCount).toBe(1_500)
    expect(kpis.outstandingCents).toBe(3_000_000)
  })

  // Con `service_role` en juego en otras rutas del repo, la regla de la casa es `clinic_id` a mano
  // SIEMPRE. Una suma que se filtre entre clínicas le muestra a un vet la plata de otra veterinaria.
  it("toda consulta filtra por clinic_id", async () => {
    const filtros: Filtro[] = []
    await getDashboardKpis(clienteFalso({ invoices: [factura(1, 0)] }, filtros), CLINICA, MES)

    const porClinica = filtros.filter((f) => f.columna === "clinic_id")
    expect(porClinica.length).toBeGreaterThanOrEqual(4)
    expect(porClinica.every((f) => f.valor === CLINICA)).toBe(true)
  })
})

describe("getStockMap suma todos los movimientos", () => {
  const mov = (item: string, qty: number) => ({ item_id: item, qty })

  it("suma entradas y salidas por ítem", async () => {
    const mapa = await getStockMap(
      clienteFalso({ inventory_movements: [mov("a", 10), mov("a", -3), mov("b", 5)] }),
      CLINICA,
    )
    expect(mapa.get("a")).toBe(7)
    expect(mapa.get("b")).toBe(5)
  })

  // Un movimiento por venta y por compra llega a mil antes de lo que parece — lo dice el comentario
  // de la propia función. Sin paginar, el inventario mostraría existencias de menos.
  it("con 2.300 movimientos no se queda en los primeros mil", async () => {
    const muchos = Array.from({ length: 2_300 }, () => mov("a", 1))
    const mapa = await getStockMap(clienteFalso({ inventory_movements: muchos }), CLINICA)
    expect(mapa.get("a")).toBe(2_300)
  })

  // Las cantidades son `numeric`: 0.1 + 0.2 da 0.30000000000000004 y el inventario mostraría eso.
  it("redondea la basura de los flotantes", async () => {
    const mapa = await getStockMap(
      clienteFalso({ inventory_movements: [mov("a", 0.1), mov("a", 0.2)] }),
      CLINICA,
    )
    expect(mapa.get("a")).toBe(0.3)
  })

  // Atajo deliberado: pedir "el stock de estos cero ítems" no es una consulta, es un mapa vacío.
  // Sin él, el `.in('item_id', [])` traería la clínica entera.
  it("con una lista vacía de ítems no consulta nada", async () => {
    const filtros: Filtro[] = []
    const mapa = await getStockMap(clienteFalso({ inventory_movements: [mov("a", 9)] }, filtros), CLINICA, [])
    expect(mapa.size).toBe(0)
    expect(filtros).toEqual([])
  })

  it("filtra por clinic_id", async () => {
    const filtros: Filtro[] = []
    await getStockMap(clienteFalso({ inventory_movements: [mov("a", 1)] }, filtros), CLINICA)
    expect(filtros).toContainEqual({ tabla: "inventory_movements", columna: "clinic_id", valor: CLINICA })
  })
})

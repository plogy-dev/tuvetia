/**
 * Crear una cuenta abre la CUENTA, no un buscador.
 *
 * ── LO QUE PASÓ ───────────────────────────────────────────────────────────────────────────────
 *
 * David, 25-ago, con una captura: apretó «Crear la primera factura» y le apareció una caja de
 * búsqueda. Sus palabras: «este primer paso toca eliminarlo» y «que no haya que usar lupa al
 * principio» — la lupa era literal, el icono del buscador.
 *
 * El 24-ago se había arreglado el botón «Registrar venta» para que abriera la cuenta lista
 * (`?mostrador=1`), como hace OkVet. Pero los OTROS caminos a esa misma pantalla quedaron apuntando
 * al buscador, así que el módulo hacía dos cosas distintas según por dónde entraras — que es peor
 * que no haber arreglado ninguno.
 *
 * ── POR QUÉ UN TEST ───────────────────────────────────────────────────────────────────────────
 *
 * Porque el defecto no fue el flujo: fue que un arreglo se aplicó a UN enlace y había tres. Agregar
 * un cuarto camino a «nueva» —desde el tablero, desde una consulta, desde un titular— es lo más
 * natural del mundo, y quien lo agregue va a copiar el `href` de al lado sin saber nada de esto.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const sinComentarios = (ruta: string) =>
  readFileSync(ruta, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

const LISTA = sinComentarios("src/app/dashboard/facturacion/page.tsx")
const NUEVA = sinComentarios("src/app/dashboard/facturacion/nueva/page.tsx")

describe("las dos entradas principales abren la cuenta", () => {
  it("«Registrar venta»", () => {
    const i = LISTA.indexOf("Registrar venta")
    expect(i).toBeGreaterThan(-1)
    expect(LISTA.slice(Math.max(0, i - 300), i)).toContain("/dashboard/facturacion/nueva?mostrador=1")
  })

  it("«Crear la primera factura» — POR ACÁ ENTRÓ DAVID", () => {
    // Es el camino natural de una clínica sin facturas, o sea el de toda clínica nueva: el primero
    // que ve alguien que estrena el módulo.
    const i = LISTA.indexOf("Crear la primera factura")
    expect(i).toBeGreaterThan(-1)
    expect(LISTA.slice(Math.max(0, i - 300), i)).toContain("/dashboard/facturacion/nueva?mostrador=1")
  })
})

describe("el buscador dejó de ser un paso", () => {
  it("no se anuncia como «Paso 1 de 2»", () => {
    // El rótulo se puso el 23-ago con buen criterio —quien llegaba a un buscador sin aviso creía
    // haberse equivocado de pantalla— pero era la curita de un flujo equivocado. Sin paso que
    // atravesar, no hay paso que nombrar.
    expect(NUEVA).not.toContain("Paso 1 de 2")
    expect(NUEVA).not.toContain("Paso 2 de 2")
  })

  it("y dice que se puede seguir sin elegir a nadie", () => {
    // Una venta de mostrador no necesita cliente. Que la pantalla lo diga es lo que la convierte de
    // peaje en opción.
    expect(NUEVA).toContain("no hace falta")
  })
})

describe("el buscador sigue existiendo, como selector", () => {
  it("se llega desde «Editar» del carrito", () => {
    const carrito = sinComentarios("src/components/facturacion/InvoiceCart.tsx")
    const i = carrito.indexOf('href="/dashboard/facturacion/nueva"')
    expect(i, "el «Editar» del carrito tiene que llevar al selector").toBeGreaterThan(-1)
    expect(carrito.slice(i, i + 400)).toContain("Editar")
  })

  it("y desde el aviso de consultas sin facturar", () => {
    // Ése es el único camino donde buscar ES el punto: ya se sabe a quién se le cobra y lo que
    // falta es elegir cuál de las consultas.
    const i = LISTA.indexOf("consultas recientes sin facturar")
    expect(i).toBeGreaterThan(-1)
    expect(LISTA.slice(Math.max(0, i - 900), i)).toContain('"/dashboard/facturacion/nueva"')
  })
})

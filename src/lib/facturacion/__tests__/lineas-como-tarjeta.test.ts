/**
 * Cada línea de la cuenta es una tarjeta de dos filas, no una fila de tabla.
 *
 * ── POR QUÉ NO ES SÓLO FIDELIDAD ──────────────────────────────────────────────────────────────
 *
 * La referencia lo hace así, sí. Pero la razón por la que se cambió tiene números: la tabla que
 * había declaraba `min-w-[760px]` y se desplazaba en horizontal. En el portátil de una recepción,
 * «Monto» quedaba fuera de la pantalla justo mientras se tecleaba la cantidad — o sea, no se podía
 * ver el efecto de lo que se estaba escribiendo.
 *
 * Volver a una tabla es exactamente el «lo simplifico» que alguien hará dentro de tres meses sin
 * saber esto. El test no lo impide: lo convierte en una decisión.
 *
 * ── Y EL ORDEN DE LAS DOS FILAS IMPORTA ───────────────────────────────────────────────────────
 *
 * Arriba lo que se teclea en TODA venta —concepto, valor unitario, descuento, cantidad—; abajo lo
 * tributario, que casi nunca se toca porque en una línea de catálogo el IVA viene del ítem. Al
 * revés, lo raro tapa lo común.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const FUENTE = readFileSync("src/components/facturacion/InvoiceCart.tsx", "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "")

describe("las líneas son tarjetas", () => {
  it("NO son una tabla que se desplaza en horizontal", () => {
    // Es lo que se vino a quitar: con 760 px de ancho mínimo, el monto quedaba fuera de pantalla
    // mientras se tecleaba la cantidad.
    expect(FUENTE).not.toContain("min-w-[760px]")
    expect(FUENTE).not.toContain("<thead")
  })

  it("cada línea es un elemento de lista propio", () => {
    const i = FUENTE.indexOf("lines.map((l, idx)")
    expect(i).toBeGreaterThan(-1)
    expect(FUENTE.slice(i, i + 600)).toContain("<li key={l.key}")
  })
})

describe("el orden de las dos filas", () => {
  it("lo que se teclea siempre va ARRIBA de lo tributario", () => {
    // «Cantidad» es de la primera fila y «Valor base» de la segunda. Si se invirtieran, lo que casi
    // nunca se toca taparía lo que se toca en toda venta.
    const iCantidad = FUENTE.indexOf(">Cantidad<")
    const iBase = FUENTE.indexOf(">Valor base<")
    expect(iCantidad).toBeGreaterThan(-1)
    expect(iBase).toBeGreaterThan(iCantidad)
  })

  it("están los cinco campos de la primera fila, con los nombres de la referencia", () => {
    for (const campo of [">Concepto<", ">Valor unitario<", ">Descuento<", ">Cantidad<", ">Monto<"]) {
      expect(FUENTE, `falta ${campo}`).toContain(campo)
    }
  })

  it("y los dos de la segunda", () => {
    expect(FUENTE).toContain(">IVA<")
    expect(FUENTE).toContain(">Valor base<")
  })
})

describe("plegar", () => {
  it("se guarda lo PLEGADO, no lo desplegado", () => {
    // Con un conjunto de «abiertas» habría que acordarse de agregar cada línea nueva en los tres
    // sitios que las crean — y la que se olvide nace cerrada, que es lo contrario de lo que espera
    // quien acaba de agregarla.
    expect(FUENTE).toContain("const [plegadas, setPlegadas]")
    expect(FUENTE).not.toContain("desplegadas")
  })

  it("una tarjeta plegada sigue mostrando su monto", () => {
    // Plegar sirve para no perder de vista el total de las líneas anteriores; esconder también el
    // monto quitaría justamente lo que se quería conservar.
    const i = FUENTE.indexOf("plegada && amounts")
    expect(i).toBeGreaterThan(-1)
    expect(FUENTE.slice(i, i + 200)).toContain("formatCOP(amounts.totalCents)")
  })

  it("el botón dice qué hace, en los dos estados", () => {
    expect(FUENTE).toContain('aria-label={plegada ? "Desplegar la línea" : "Plegar la línea"}')
    expect(FUENTE).toContain("aria-expanded={!plegada}")
  })
})

describe("el monto de la línea sale del cálculo, no de un recálculo local", () => {
  it("usa `calculo.montos`", () => {
    // Recalculando acá se ignoraría el descuento global prorrateado, y el monto de la línea no
    // sumaría al total de la cuenta.
    expect(FUENTE).toContain("calculo.montos?.[idx]")
  })
})

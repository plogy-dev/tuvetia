/**
 * Que el aviso de existencia insuficiente LLEGUE a la pantalla.
 *
 * LO QUE PASÓ, medido el 2026-08-23 contra producción. Se emitió una factura de un producto con
 * `track_stock` encendido y existencia 0. Se emitió bien, la existencia quedó en **-1**, y en
 * pantalla no apareció nada.
 *
 * EL DEFECTO NO ES EL SALDO NEGATIVO. `billing_settings.block_on_insufficient_stock` es `false` por
 * defecto y está bien que lo sea: una clínica no debería no poder cobrar una vacuna porque la
 * compra todavía no se cargó. La decisión de producto es **avisar sin bloquear**.
 *
 * El defecto es que el aviso no se veía. El servidor lo calculaba, el borrador lo traía, y el camino
 * de "Emitir ahora" lo descartaba: sólo se mostraba al guardar borrador o si la emisión fallaba. Con
 * la advertencia invisible, "avisar sin bloquear" y "no hacer nada" son exactamente lo mismo — y el
 * inventario se va a negativo sin que nadie lo note hasta que el valor a costo deja de tener sentido.
 *
 * ES UN TEST QUE LEE EL FUENTE porque no hay tests de componentes acá y porque lo que se fija es un
 * acuerdo entre dos caminos del mismo archivo: uno los mostraba y el otro no.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const CARRITO = readFileSync(
  join(process.cwd(), "src", "components", "facturacion", "InvoiceCart.tsx"),
  "utf8",
)

describe("los avisos del borrador", () => {
  it("el camino de EMITIR no los descarta", () => {
    // El `router.push` de la emisión exitosa tiene que estar precedido por algo que muestre los
    // avisos. Se busca el bloque completo para que mover el push fuera del `if` se note.
    const emision = CARRITO.slice(CARRITO.indexOf("const issued = await issueInvoiceAction"))
    expect(emision).toMatch(/draft\.warnings\.length > 0/)
    expect(emision).toMatch(/toast\.warning\(/)
    // Y el orden: primero se avisa, después se navega.
    expect(emision.indexOf("toast.warning(")).toBeLessThan(emision.indexOf("router.push(issued.url)"))
  })

  it("el camino de BORRADOR los sigue mostrando", () => {
    // No se rompe lo que ya andaba: ahí sí se corta antes de navegar, porque el borrador se puede
    // seguir editando.
    expect(CARRITO).toMatch(/setWarnings\(draft\.warnings\)/)
  })

  it("y si la emisión falla, también", () => {
    const fallo = CARRITO.slice(CARRITO.indexOf("if (!issued.ok)"))
    expect(fallo.slice(0, 400)).toMatch(/setWarnings\(draft\.warnings\)/)
  })
})

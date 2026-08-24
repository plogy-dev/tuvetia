/**
 * Que el aviso de existencia insuficiente LLEGUE a la pantalla, antes de emitir.
 *
 * LO QUE PASÓ, medido el 2026-08-23 contra producción. Se emitió una factura de un producto con
 * `track_stock` encendido y existencia 0. Se emitió bien, la existencia quedó en **-1**, y en
 * pantalla no apareció nada.
 *
 * EL DEFECTO NO ES EL SALDO NEGATIVO. `billing_settings.block_on_insufficient_stock` es `false` por
 * defecto y está bien que lo sea: una clínica no debería no poder cobrar una vacuna porque la
 * compra todavía no se cargó. La decisión de producto es **avisar sin bloquear**, y por eso el aviso
 * ES la decisión: sin él, «avisar sin bloquear» y «no hacer nada» son exactamente lo mismo.
 *
 * ── POR QUÉ ESTE TEST CAMBIÓ DE SITIO EL 24-AGO ───────────────────────────────────────────────
 *
 * Al copiar el módulo de ventas de OkVet, «Emitir ahora» SALIÓ del carrito: ahora `Guardar` crea la
 * cuenta y la emisión vive en el documento. La versión anterior de este test vigilaba un `toast` en
 * el camino de emisión del carrito — código que ya no existe ahí.
 *
 * Borrarlo habría sido reabrir el defecto en silencio, que es justo lo que un cerrojo existe para
 * impedir. Se reapuntó a los DOS sitios donde la garantía vive ahora:
 *
 *   1. EL CARRITO no navega cuando hay avisos: los muestra y ofrece el enlace a la cuenta guardada.
 *   2. EL DOCUMENTO los recalcula (`avisosDelBorrador`) y los pinta antes del botón de emitir.
 *
 * ES UN TEST QUE LEE EL FUENTE porque no hay tests de componentes acá y porque lo que se fija es un
 * acuerdo entre archivos: uno guarda y el otro emite.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/** Un fuente sin sus comentarios: la prosa de arriba nombra lo mismo que se busca abajo. */
function sinComentarios(...partes: string[]): string {
  return readFileSync(join(process.cwd(), ...partes), "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*")
    })
    .join("\n")
}

const CARRITO = sinComentarios("src", "components", "facturacion", "InvoiceCart.tsx")
const DOCUMENTO = sinComentarios("src", "app", "dashboard", "facturacion", "[id]", "page.tsx")
const INVOICES = sinComentarios("src", "lib", "facturacion", "invoices.ts")

describe("los avisos del borrador — al guardar la cuenta", () => {
  it("el carrito NO navega en silencio cuando hay avisos", () => {
    // Guardar con avisos tiene que cortar antes del `router.push`: si navegara igual, el aviso
    // pasaría por pantalla sin que nadie lo lea, que es como se llegó al inventario en -1.
    const guardado = CARRITO.slice(CARRITO.indexOf("const created = await createInvoiceDraft"))
    expect(guardado).toMatch(/avisos\.length > 0/)
    expect(guardado).toMatch(/setWarnings\(avisos\)/)
    // Y el orden: primero se avisa y se corta, después está el push del camino limpio.
    expect(guardado.indexOf("setWarnings(avisos)")).toBeLessThan(
      guardado.indexOf("router.push(created.url)"),
    )
  })

  it("ofrece el enlace a la cuenta que YA quedó guardada", () => {
    // Cortar sin dar salida sería peor que navegar: el vet creería que no se guardó y volvería a
    // pulsar, dejando dos cuentas.
    expect(CARRITO).toMatch(/setDraftUrl\(created\.url\)/)
  })
})

describe("los avisos del borrador — al emitir el documento", () => {
  it("el documento los recalcula antes de emitir", () => {
    expect(DOCUMENTO).toMatch(/avisosDelBorrador\(/)
    expect(DOCUMENTO).toMatch(/avisos\.length > 0/)
  })

  it("los pinta ANTES del panel que emite, no después", () => {
    // Debajo del botón, el aviso llega tarde: se lee cuando el consecutivo ya se quemó.
    const iAviso = DOCUMENTO.indexOf("avisos.length > 0")
    const iPanel = DOCUMENTO.indexOf("<InvoiceActionsPanel")
    expect(iAviso).toBeGreaterThan(-1)
    expect(iPanel).toBeGreaterThan(-1)
    expect(iAviso).toBeLessThan(iPanel)
  })

  it("se recalculan con la MISMA validación que usa el borrador al crearse", () => {
    // Si `avisosDelBorrador` tuviera su propia idea de qué merece aviso, las dos pantallas se
    // separarían y la que emite sería la que se queda corta.
    const fn = INVOICES.slice(INVOICES.indexOf("export async function avisosDelBorrador"))
    expect(fn).toMatch(/previewDraft\(/)
    expect(fn).toMatch(/preview\.warnings/)
  })

  it("sólo aplica a borradores: una factura ya emitida no se re-valida", () => {
    const fn = INVOICES.slice(INVOICES.indexOf("export async function avisosDelBorrador"))
    expect(fn.slice(0, 300)).toMatch(/status !== 'BORRADOR'/)
  })
})

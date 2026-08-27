/**
 * Lo irreversible pesa más que lo reversible, y ningún control miente.
 *
 * ── LOS DOS DEFECTOS, de la auditoría de UX del 27-ago ─────────────────────────────────────────
 *
 * 1 · LA FRICCIÓN ESTABA AL REVÉS.
 *
 *       Descartar borrador   reversible en la práctica, no toca el consecutivo   →  pedía confirmar
 *       Emitir               IRREVERSIBLE, quema el consecutivo de la DIAN       →  no pedía nada
 *
 *     El propio panel ya decía, en letra chica bajo el botón, que «una factura emitida solo se
 *     corrige con nota crédito»: la app sabía que era irreversible y aun así lo dejaba a un clic —
 *     el mismo clic con el que se venía de armar la cuenta.
 *
 * 2 · EL SELECT «FORMA DE PAGO» DEL CARRITO NO HACÍA NADA.
 *
 *     Hay dos controles con ese mismo rótulo en pantallas consecutivas: en el carrito significa
 *     Contado/Crédito y en la emisión, Pagado ahora/Pendiente/Abono. El segundo ignoraba al primero
 *     —`makeDefaultPlan` arrancaba siempre en `PAGADO_AHORA`— y al emitir el servidor SOBRESCRIBE
 *     `payment_terms` con el resultado elegido en la emisión.
 *
 *     O sea que elegir «Crédito» y no tocar nada más emitía la factura COMO PAGADA. Un control que
 *     se puede cambiar y no cambia nada es peor que no tenerlo: el vet cree que ya lo dijo.
 *
 * ── POR QUÉ UN CERROJO DE TEXTO ────────────────────────────────────────────────────────────────
 *
 * Ninguna de las dos cosas falla: emitir sin confirmar funciona, y un default ignorado produce una
 * factura perfectamente válida — sólo que no la que el vet quería. No hay assertion natural sobre
 * «esto sorprende», así que lo que se fija es la ESTRUCTURA que evita la sorpresa.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const leer = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8")

const PANEL = leer("src", "components", "facturacion", "InvoiceActionsPanel.tsx")
const SECCION = leer("src", "components", "facturacion", "PaymentSection.tsx")
const DOCUMENTO = leer("src", "app", "dashboard", "facturacion", "[id]", "page.tsx")
const INVOICES = leer("src", "lib", "facturacion", "invoices.ts")

describe("emitir pide confirmación, y descartar no pide más que emitir", () => {
  it("el botón de emitir abre un paso de confirmación en vez de emitir", () => {
    expect(PANEL).toMatch(/onClick=\{\(\) => setConfirmando\('emitir'\)\}/)
  })

  it("la confirmación dice que el consecutivo se consume y no se recicla", () => {
    // Confirmar por confirmar sólo agrega un clic. Lo que hace que valga la pena es que explique
    // QUÉ se pierde — y eso es justo lo que un `window.confirm` no puede hacer bien.
    const caja = PANEL.slice(PANEL.indexOf("confirmando === 'emitir'"))
    expect(caja).toMatch(/consecutivo/)
    expect(caja).toMatch(/nota crédito/)
  })

  it("ningún diálogo del sistema quedó en el panel", () => {
    // `window.confirm` aparece fuera de contexto, no explica nada y en algunos navegadores no sale.
    // Las menciones que quedan son comentarios que cuentan por qué se fueron.
    const sinComentarios = PANEL.replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))
      .join("\n")
    expect(sinComentarios).not.toMatch(/window\.(confirm|prompt|alert)\(/)
  })
})

describe("lo que se eligió en el carrito llega a la emisión", () => {
  it("makeDefaultPlan recibe los términos y no arranca siempre en pagado", () => {
    const fn = SECCION.slice(SECCION.indexOf("export function makeDefaultPlan"))
    expect(fn).toMatch(/terminos/)
    expect(fn.slice(0, 900)).toMatch(/CREDIT/)
  })

  it("el panel se los pasa, y el documento se los pasa al panel", () => {
    expect(PANEL).toMatch(/makeDefaultPlan\(defaultTermsDays,\s*paymentTerms\)/)
    expect(DOCUMENTO).toMatch(/paymentTerms=\{invoice\.payment_terms\}/)
  })
})

describe("el aviso de las 5 UVT llega a la pantalla que emite", () => {
  it("avisosDelBorrador devuelve el umbral en vez de descartarlo", () => {
    // `previewDraft` ya lo calculaba y esta función lo tiraba, así que el aviso vivía sólo en el
    // carrito — un paso ANTES de la única pantalla donde todavía se puede cambiar el tipo de
    // documento sin haber quemado el consecutivo.
    const fn = INVOICES.slice(INVOICES.indexOf("export async function avisosDelBorrador"))
    expect(fn).toMatch(/preview\.posThreshold/)
  })

  it("el documento lo pinta, y antes del panel que emite", () => {
    const iAviso = DOCUMENTO.indexOf("umbralPos?.exceeds")
    const iPanel = DOCUMENTO.indexOf("<InvoiceActionsPanel")
    expect(iAviso).toBeGreaterThan(-1)
    expect(iPanel).toBeGreaterThan(-1)
    expect(iAviso).toBeLessThan(iPanel)
  })
})

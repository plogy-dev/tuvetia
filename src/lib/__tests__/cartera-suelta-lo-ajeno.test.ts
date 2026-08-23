/**
 * Que cartera no se quede con un mensaje que no es de cobranza.
 *
 * ── EL DEFECTO ──────────────────────────────────────────────────────────────────────────────────
 *
 * `routeInbound` prueba primero cartera y, si devuelve `handled: true`, NO corre el modo auto
 * general. Cartera reclamaba TODO mensaje de un titular con factura cobrable, incluido el intent
 * `OTRO` — que es literalmente "no clasificable" y cuya acción declara `reply: null`.
 *
 * Resultado: una pregunta trivial —"¿a qué hora abren?"— de alguien que además debe plata recibía
 * **silencio**. Ni respuesta de cartera (no tiene ninguna para `OTRO`) ni del modo auto (nunca lo
 * vio). Sólo una tarea, que existía únicamente para deudores.
 *
 * ── LO QUE ESTOS TESTS FIJAN ────────────────────────────────────────────────────────────────────
 *
 * Las tres piezas de la cadena, que viven en tres archivos y ninguno obliga a los otros:
 *
 *   1. `OTRO` no tiene respuesta → reclamarlo ES condenar al silencio.
 *   2. `wa-router` lo suelta… salvo con adjunto.
 *   3. `inbound-router` cae al modo auto cuando no se reclama.
 *
 * La excepción del adjunto es la que más fácil se "limpia" sin entender: una foto de alguien que
 * debe plata es un comprobante hasta que se demuestre lo contrario, y soltarla perdería
 * `storeReceiptReference` — un pago que el cliente cree haber avisado y del que no queda rastro.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { INTENT_ACTIONS } from "@/lib/cartera/intents"

const sinComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const leer = (r: string) => sinComentarios(readFileSync(join(process.cwd(), r), "utf8"))

const ROUTER = leer("src/lib/cartera/wa-router.ts")
const ENTRANTES = leer("src/lib/whatsapp/inbound-router.ts")

describe("la premisa: OTRO no tiene respuesta", () => {
  // Si algún día `OTRO` tuviera una respuesta propia, reclamarlo dejaría de ser un problema y este
  // archivo estaría protegiendo un riesgo que ya no existe. Conviene enterarse.
  it("la acción de OTRO declara reply: null", () => {
    expect(INTENT_ACTIONS.OTRO.reply).toBeNull()
  })

  // Y los demás sí la tienen: son los que cartera debe seguir reclamando.
  it("los intents de cobranza sí responden", () => {
    for (const i of ["YA_PAGUE", "PROMESA_PAGO", "PEDIR_ENLACE", "CONTACTO_HUMANO"] as const) {
      expect(INTENT_ACTIONS[i].reply, i).not.toBeNull()
    }
  })
})

describe("cartera suelta lo que no es suyo", () => {
  it("devuelve handled:false cuando el intent es OTRO", () => {
    expect(ROUTER).toMatch(/intent === ['"]OTRO['"]/)
    expect(ROUTER).toMatch(/return \{ handled: false \}/)
  })

  // LA EXCEPCIÓN QUE NO HAY QUE BORRAR. Sin el `!hasMedia`, un comprobante clasificado como OTRO
  // se soltaría y `storeReceiptReference` no correría: el pago quedaría sin registrar.
  it("pero NO lo suelta si vino con adjunto", () => {
    const corte = ROUTER.indexOf("intent === 'OTRO'")
    expect(corte, "no se encontró el corte por OTRO").toBeGreaterThan(-1)
    expect(ROUTER.slice(corte, corte + 120)).toContain("hasMedia")
  })

  // El corte va DESPUÉS de clasificar —hace falta el intent— y ANTES de ejecutar: ejecutar y
  // después soltar abriría la tarea igual, que es la mitad del ruido que se está quitando.
  it("suelta antes de ejecutar las acciones de cartera", () => {
    const clasifica = ROUTER.indexOf("classifyCarteraIntent")
    const suelta = ROUTER.indexOf("intent === 'OTRO'")
    const ejecuta = ROUTER.indexOf("executeCarteraInbound(admin")
    expect(clasifica).toBeLessThan(suelta)
    expect(suelta).toBeLessThan(ejecuta)
  })
})

describe("y el que no se reclama cae al modo auto", () => {
  // La otra mitad de la cadena. Sin esto, soltar el mensaje lo mandaría al vacío.
  it("inbound-router corre maybeAutoReply cuando cartera no reclama", () => {
    expect(ENTRANTES).toMatch(/if\s*\(handled\)\s*return/)
    expect(ENTRANTES).toMatch(/await maybeAutoReply\(/)
    expect(ENTRANTES.indexOf("if (handled) return")).toBeLessThan(
      ENTRANTES.indexOf("await maybeAutoReply("),
    )
  })
})

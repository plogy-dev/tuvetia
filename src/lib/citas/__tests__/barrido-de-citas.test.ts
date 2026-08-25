/**
 * El barrido de recordatorios de cita.
 *
 * Lo que se fija acá no es el cálculo —eso está en `recordatorio.test.ts`— sino tres decisiones que
 * alguien puede deshacer de buena fe y que sólo se descubren en el teléfono de un titular:
 *
 *   1. QUE SE SELLE ANTES DE MANDAR. El cron se reintenta. Sellando después, un timeout deja el
 *      aviso sin marca y el próximo intento lo manda de nuevo. El peor caso tiene que ser «no
 *      llegó», que se nota, y no «llegó tres veces», que molesta al titular.
 *   2. QUE NO SE MEZCLE CON COBRANZA. Las ventanas de la Ley 2300 que respeta cartera son para
 *      perseguir una deuda; un recordatorio de cita es transaccional. Comparten el puerto de salida
 *      y nada más — si esto entrara al motor de cartera, un cambio en las reglas de cobranza movería
 *      sin querer los avisos de cita.
 *   3. QUE NO SE AVISE A CITAS CANCELADAS. Avisar de una que no va a pasar es peor que no avisar:
 *      el titular se presenta.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const sinComentarios = (ruta: string) =>
  readFileSync(ruta, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

const BARRIDO = sinComentarios("src/lib/citas/barrido.ts")
const CRON = sinComentarios("src/app/api/cron/cartera/route.ts")

describe("exactamente una vez", () => {
  it("SELLA ANTES DE MANDAR, no después", () => {
    const iSellar = BARRIDO.indexOf("recordatorio_enviado_en: ahora.toISOString()")
    const iMandar = BARRIDO.indexOf("sendWhatsAppText(")
    expect(iSellar).toBeGreaterThan(-1)
    expect(iMandar).toBeGreaterThan(-1)
    expect(iSellar, "el sello tiene que ir antes del envío").toBeLessThan(iMandar)
  })

  it("el sello es condicional: sólo si nadie lo puso antes", () => {
    // Dos corridas simultáneas —un reintento encima del cron— llegarían las dos a la misma cita.
    // El `.is(..., null)` es lo que hace que sólo una gane.
    const i = BARRIDO.indexOf("recordatorio_enviado_en: ahora.toISOString()")
    expect(BARRIDO.slice(i, i + 300)).toContain('.is("recordatorio_enviado_en", null)')
  })

  it("sólo busca citas que todavía no tienen aviso", () => {
    const i = BARRIDO.indexOf('.from("appointments")')
    expect(BARRIDO.slice(i, i + 900)).toContain('.is("recordatorio_enviado_en", null)')
  })

  it("una cita SIN TELÉFONO no se sella", () => {
    // No se intentó nada: si mañana le cargan el número, que le llegue. Sellar acá sería perder el
    // aviso para siempre por un dato que la clínica todavía puede completar.
    const i = BARRIDO.indexOf("sinTelefono += 1")
    expect(i).toBeGreaterThan(-1)
    expect(BARRIDO.slice(i, i + 120)).toContain("continue")
    // El sello aparece DESPUÉS de ese `continue`, no antes.
    expect(BARRIDO.indexOf("recordatorio_enviado_en: ahora")).toBeGreaterThan(i)
  })
})

describe("no es cobranza", () => {
  it("no pasa por el motor ni por el outbox de cartera", () => {
    // Comparten el puerto de salida de WhatsApp y nada más.
    expect(BARRIDO).not.toContain("@/lib/cartera/scheduler")
    expect(BARRIDO).not.toContain("@/lib/cartera/outbox")
    expect(BARRIDO).not.toContain("RealMessaging")
    expect(BARRIDO).toContain("sendWhatsAppText")
  })

  it("corre AISLADO dentro del cron: si falla, la cobranza sale igual", () => {
    const i = CRON.indexOf("correrRecordatoriosDeCita()")
    expect(i).toBeGreaterThan(-1)
    const bloque = CRON.slice(Math.max(0, i - 200), i + 300)
    expect(bloque).toContain("try")
    expect(bloque).toContain("catch")
  })

  it("y no tiene cron propio: los dos cupos del plan están usados", () => {
    const vercel = readFileSync("vercel.json", "utf8")
    expect(JSON.parse(vercel).crons).toHaveLength(2)
    expect(vercel).not.toContain("citas")
  })
})

describe("a quién se le avisa", () => {
  it("sólo a citas en pie, por lista blanca", () => {
    expect(BARRIDO).toContain("ESTADOS_QUE_SE_AVISAN")
    expect(BARRIDO).toContain('.in("status"')
  })

  it("sólo a citas con titular", () => {
    // Sin `owner_id` no hay a quién avisarle: una cita de mostrador no tiene destinatario.
    expect(BARRIDO).toContain('.not("owner_id", "is", null)')
  })

  it("la ventana del día va en hora de Bogotá, no en UTC", () => {
    // En UTC la ventana se corre cinco horas: entrarían las citas de la madrugada siguiente y se
    // perderían las de la noche del día objetivo.
    expect(BARRIDO).toContain("T00:00:00-05:00")
    expect(BARRIDO).toContain("T23:59:59-05:00")
  })
})

describe("una clínica que falla no deja a las demás sin avisar", () => {
  it("el barrido devuelve el recuento en vez de lanzar", () => {
    const runAll = sinComentarios("src/lib/citas/run-all.ts")
    expect(runAll).toContain("resultados.push")
    // El error de lectura de una clínica se loguea y se devuelve vacío, no se propaga.
    expect(BARRIDO).toContain("return vacio")
  })
})

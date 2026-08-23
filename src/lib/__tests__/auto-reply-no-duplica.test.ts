/**
 * Que el modo auto no le mande DOS respuestas al mismo titular.
 *
 * ── EL DEFECTO, Y POR QUÉ ESTE ARCHIVO EXISTE ───────────────────────────────────────────────────
 *
 * La idempotencia se consultaba contra `athos_actions`, pero esa fila se escribe DESPUÉS de enviar.
 * Entre el chequeo y la escritura pasan varios segundos —el debounce más la llamada al modelo—, así
 * que un reintento del webhook colaba una segunda respuesta. Se arregló el 29-jul (`a64cfdc`) con
 * un compare-and-set sobre `auto_reply_claimed_at`: sólo una invocación sella la columna, la otra
 * recibe cero filas y se calla.
 *
 * **El arreglo está, y no había NADA que lo protegiera.** Se puede quitar el `.is(…, null)`, o
 * mover la reserva después del modelo, y ningún test se pone en rojo. Y el síntoma no aparece
 * probando a mano: hace falta que el webhook reintente dentro de esa ventana, cosa que pasa en
 * producción y casi nunca en desarrollo. Lo que se ve, cuando se ve, es un cliente recibiendo el
 * mismo mensaje dos veces.
 *
 * ── POR QUÉ LEE EL FUENTE ───────────────────────────────────────────────────────────────────────
 *
 * Igual que `onboarding-tour-anclas` y `pastillas-del-tablero`: no hay infraestructura de tests de
 * integración acá —vitest corre en `node`— y ejercitar esto de verdad pediría dos invocaciones
 * concurrentes contra una base real. Lo que se fija es el ACUERDO entre tres líneas del archivo, y
 * eso se lee.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const FUENTE = readFileSync(
  join(process.cwd(), "src/lib/whatsapp/auto-reply.ts"),
  "utf8",
)

/** Sin comentarios: los de este archivo citan el defecto y el escáner los leería como código. */
const CODIGO = FUENTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("la reserva del entrante", () => {
  // Sin el `.is(…, null)` el update pisa cualquier reserva previa y las DOS invocaciones creen
  // haber ganado. Deja de ser un compare-and-set y vuelve a ser el bug.
  it("es un compare-and-set, no un update a secas", () => {
    expect(CODIGO).toContain("auto_reply_claimed_at")
    expect(CODIGO).toMatch(/\.is\(\s*["']auto_reply_claimed_at["']\s*,\s*null\s*\)/)
  })

  // Sin el `.select()`, PostgREST no devuelve las filas afectadas y no hay forma de saber si se
  // gano la carrera: el código seguiría de largo en los dos casos.
  it("pide de vuelta las filas afectadas, que es como sabe si ganó", () => {
    const reserva = CODIGO.slice(
      CODIGO.indexOf("auto_reply_claimed_at:"),
      CODIGO.indexOf("auto_reply_claimed_at:") + 500,
    )
    expect(reserva).toMatch(/\.select\(/)
  })

  it("y se calla cuando pierde", () => {
    expect(CODIGO).toMatch(/if\s*\(!\(claimed\s*\?\?\s*\[\]\)\.length\)\s*return/)
  })
})

describe("el orden es lo que cierra la ventana", () => {
  // ÉSTE ES EL TEST QUE IMPORTA. La reserva tiene que ocurrir ANTES de llamar al modelo: si se
  // hiciera después, entre el debounce y la respuesta vuelve a haber varios segundos en los que un
  // reintento entra limpio — que es exactamente el bug original con otra cara.
  it("se reserva ANTES de llamar al modelo", () => {
    const reserva = CODIGO.indexOf("auto_reply_claimed_at:")
    const modelo = CODIGO.indexOf("generateText(")

    expect(reserva, "no se encontró la reserva").toBeGreaterThan(-1)
    expect(modelo, "no se encontró la llamada al modelo").toBeGreaterThan(-1)
    expect(
      reserva,
      "la reserva quedó DESPUÉS del modelo: entre el debounce y la respuesta se reabre la ventana " +
        "en la que un reintento del webhook manda una segunda respuesta al titular",
    ).toBeLessThan(modelo)
  })

  // El debounce espera varios segundos a propósito —para no contestar a medias si el titular
  // sigue escribiendo—, y es justo lo que hace ancha la ventana. Si desapareciera, este archivo
  // estaría protegiendo un riesgo que ya no existe y convendría saberlo.
  it("sigue habiendo un debounce, que es lo que hace ancha la ventana", () => {
    expect(CODIGO).toMatch(/DEBOUNCE_MS/)
  })
})

describe("el fallo de la reserva se distingue de perder la carrera", () => {
  // Perder es normal y va en silencio. Que la consulta FALLE —tipicamente la 0038 sin aplicar— es
  // otra cosa: sin este log el modo auto se apagaria entero y nadie se enteraria.
  it("un error de la consulta se registra", () => {
    expect(CODIGO).toMatch(/claimError/)
    expect(CODIGO).toMatch(/console\.error\(/)
  })
})

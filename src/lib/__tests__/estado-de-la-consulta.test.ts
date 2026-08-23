/**
 * Que el estado de una consulta se lea igual en todas partes, y que no mienta.
 *
 * DOS COSAS DISTINTAS SE FIJAN ACÁ, y las dos se rompieron de verdad:
 *
 * 1. UNA SOLA FUENTE. El mapa estaba copiado en tres pantallas —lista de consultas, riel de Athos
 *    e historia del paciente—. Tres copias de un diccionario no divergen el día que se escriben:
 *    divergen el día que alguien renombra un estado en una y no en las otras dos.
 *
 * 2. QUE `generating_note` NO DIGA "GENERANDO". Es el que costó caro. El backend pone ese estado
 *    al TERMINAR de transcribir, y sólo se sale cuando un humano abre la consulta y aprieta
 *    "Generar sugerencia": es un botón, no una tarea de fondo. La etiqueta decía "Generando nota",
 *    así que el vet leía que la máquina trabajaba y esperaba. Medido contra producción el
 *    2026-08-22: cuatro consultas atascadas, de cuatro días distintos, todas con transcript y
 *    ninguna con nota. A ninguna le falló nada; a todas les faltaba un clic.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"

import { describe, expect, it } from "vitest"

import { ESTADO_DE_CONSULTA, comoSeLee } from "@/lib/consultas/estado"

const RAIZ = join(process.cwd(), "src")

function fuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) return e.name === "__tests__" ? [] : fuentes(ruta)
    return /\.tsx?$/.test(e.name) ? [ruta] : []
  })
}

describe("el estado de una consulta", () => {
  it("no promete un trabajo que nadie está haciendo", () => {
    const etiqueta = ESTADO_DE_CONSULTA.generating_note
    // El corazón del asunto: de este estado se sale A MANO. Si la etiqueta vuelve a sugerir que la
    // máquina está en eso, el vet vuelve a esperar para siempre.
    expect(etiqueta).not.toMatch(/generando/i)
    expect(etiqueta).toMatch(/falta|pendiente|list[ao]|esperando/i)
  })

  it("`transcribing` sí puede decir que está trabajando, porque lo está", () => {
    // La distinción importa: ése lo sostiene el backend mientras transcribe. No todo estado en
    // gerundio es mentira — sólo el que depende de un humano.
    expect(ESTADO_DE_CONSULTA.transcribing).toMatch(/transcribiendo/i)
  })

  it("cubre los cinco estados del flujo del Phantom", () => {
    expect(Object.keys(ESTADO_DE_CONSULTA).sort()).toEqual(
      ["completed", "generating_note", "open", "review", "transcribing"].sort(),
    )
  })

  it("un estado desconocido no borra la celda", () => {
    // Preferible mostrar el crudo que un hueco: si mañana nace un estado, la pantalla lo delata en
    // vez de disimularlo.
    expect(comoSeLee("un_estado_nuevo")).toBe("un_estado_nuevo")
    expect(comoSeLee(null)).toBe("—")
    expect(comoSeLee("review")).toBe("En revisión")
  })

  it("y ninguna pantalla se guarda su propia copia del mapa", () => {
    const culpables = fuentes(RAIZ)
      .filter((f) => !f.endsWith(join("lib", "consultas", "estado.ts")))
      .filter((f) => /generating_note\s*:/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(RAIZ, "").split(sep).join("/"))

    expect(culpables, "vuelven a tener su propio diccionario de estados").toEqual([])
  })
})

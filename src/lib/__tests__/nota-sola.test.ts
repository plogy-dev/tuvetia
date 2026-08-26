/**
 * La nota del Fantasma se pide sola — y nadie puede volver a dejarla esperando un clic.
 *
 * ── POR QUÉ ESTE CERROJO EXISTE ───────────────────────────────────────────────────────────────
 *
 * `generating_note` acumuló consultas colgadas DOS veces: 4 el 22-ago (se arregló la etiqueta) y
 * 6 el 25-ago, tres de ellas posteriores a ese arreglo. La lección medida es que un paso que sólo
 * avanza a mano se queda quieto, así que la generación pasó a dispararse al abrir la consulta.
 *
 * La regresión probable no es borrar la función: es que un refactor de `load()` la deje de llamar
 * — compila igual, la pantalla se ve igual, y las consultas vuelven a colgarse en silencio hasta
 * que alguien mida la base otra vez. Por eso la segunda mitad escanea la pantalla.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { laNotaSePideSola } from "@/lib/consultas/nota-sola"

describe("cuándo se pide sola", () => {
  it("transcrita y sin nota: se pide", () => {
    expect(
      laNotaSePideSola({ status: "generating_note", hayTranscripcion: true, hayNota: false }),
    ).toBe(true)
  })

  it("con nota ya hecha, jamás — pisaría lo que el vet pudo haber editado", () => {
    expect(
      laNotaSePideSola({ status: "generating_note", hayTranscripcion: true, hayNota: true }),
    ).toBe(false)
    expect(laNotaSePideSola({ status: "review", hayTranscripcion: true, hayNota: true })).toBe(false)
  })

  it("sin transcripción no hay de dónde generar", () => {
    expect(
      laNotaSePideSola({ status: "generating_note", hayTranscripcion: false, hayNota: false }),
    ).toBe(false)
  })

  it("abrir una consulta sin grabar no dispara nada", () => {
    // `open` es el estado de la consulta recién creada: entrar a mirarla no puede costar una
    // llamada de IA sobre nada.
    expect(laNotaSePideSola({ status: "open", hayTranscripcion: false, hayNota: false })).toBe(false)
    expect(laNotaSePideSola({ status: "transcribing", hayTranscripcion: false, hayNota: false })).toBe(
      false,
    )
  })
})

describe("la pantalla de consulta la usa de verdad", () => {
  const fuente = readFileSync(
    join("src", "app", "dashboard", "consultas", "[id]", "page.tsx"),
    "utf8",
  )
    // Los comentarios de este repo narran lo que el código hace: sin quitarlos, el test se
    // satisface a sí mismo leyendo la prosa. Cuarta vez que un escáner se muerde la cola así.
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

  it("load() decide con la función y dispara generate", () => {
    const i = fuente.indexOf("laNotaSePideSola(")
    expect(i, "la pantalla ya no consulta laNotaSePideSola: las consultas vuelven a colgarse").toBeGreaterThan(-1)
    // La LLAMADA («void generate(»), no cualquier «generate(»: a 300 caracteres el escáner
    // alcanzaba la DECLARACIÓN `async function generate(` que viene después del useCallback, y un
    // mutante que reemplazó la llamada por un console.log pasó el test entero. Verificado.
    expect(fuente.slice(i, i + 300)).toContain("void generate(")
  })

  it("con una guarda de un solo intento — un fallo del servicio no puede ser un bucle", () => {
    expect(fuente).toContain("autoPedida.current = true")
  })

  it("y el botón manual sigue existiendo como reintento", () => {
    expect(fuente).toContain("Generar sugerencia (Modo Fantasma)")
  })
})

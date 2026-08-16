// El rótulo de evidencia de una nota clínica.
//
// POR QUÉ ESTE ARCHIVO. La pantalla decidía el rótulo contando citas, no leyendo el veredicto del
// juez, y por eso una nota `limited` con referencias se anunciaba como "Evidencia suficiente" — lo
// contrario de lo que el juez concluyó. Estos tests fijan que el rótulo salga de la BANDA y de nada
// más.
import { describe, expect, it } from "vitest"

import {
  avisoDeEvidencia,
  bandaDeEvidencia,
  requiereAdvertencia,
  type BandaDeEvidencia,
} from "@/lib/evidencia"

describe("bandaDeEvidencia", () => {
  it("acepta las tres bandas del juez", () => {
    expect(bandaDeEvidencia("none")).toBe("none")
    expect(bandaDeEvidencia("limited")).toBe("limited")
    expect(bandaDeEvidencia("sufficient")).toBe("sufficient")
  })

  // La columna es `not null default 'sufficient'`. Replicar ese default y no inventar uno más
  // severo es deliberado: si un valor ausente cayera en "none", toda nota anterior a que existiera
  // la columna aparecería de golpe como dudosa, y eso es una afirmación que nadie hizo.
  it("un valor desconocido cae en 'sufficient', igual que el default de la columna", () => {
    expect(bandaDeEvidencia(null)).toBe("sufficient")
    expect(bandaDeEvidencia(undefined)).toBe("sufficient")
    expect(bandaDeEvidencia("")).toBe("sufficient")
    expect(bandaDeEvidencia("LIMITED")).toBe("sufficient") // no adivina mayúsculas
    expect(bandaDeEvidencia(3)).toBe("sufficient")
  })
})

describe("avisoDeEvidencia", () => {
  it("con evidencia suficiente no advierte nada", () => {
    const a = avisoDeEvidencia("sufficient")
    expect(a.advertencia).toBeNull()
    expect(a.tono).toBe("neutral")
    expect(requiereAdvertencia("sufficient")).toBe(false)
  })

  // EL CASO QUE MOTIVA TODO. Medido contra el principal el 2026-08-16: hay una nota `limited`, con
  // SIETE citas, y APROBADA — o sea que se archivó en la historia de un paciente mientras la
  // pantalla decía "Evidencia suficiente".
  it("con evidencia limitada NO dice 'suficiente' y advierte", () => {
    const a = avisoDeEvidencia("limited")
    expect(a.etiqueta).not.toMatch(/suficiente/i)
    expect(a.advertencia).toBeTruthy()
    expect(requiereAdvertencia("limited")).toBe(true)
  })

  it("sin evidencia advierte más fuerte que con evidencia limitada", () => {
    expect(avisoDeEvidencia("none").tono).toBe("grave")
    expect(avisoDeEvidencia("limited").tono).toBe("atencion")
  })

  // La advertencia la lee un veterinario antes de firmar una nota que queda en la historia. Tiene
  // que decir qué hacer, no sólo que algo anda mal.
  it("la advertencia le dice al vet qué hacer, no sólo que hay un problema", () => {
    expect(avisoDeEvidencia("limited").advertencia).toMatch(/revis/i)
    expect(avisoDeEvidencia("none").advertencia).toMatch(/transcripci[oó]n/i)
  })

  it("ninguna banda deja al vet sin etiqueta", () => {
    for (const b of ["none", "limited", "sufficient"] as BandaDeEvidencia[]) {
      expect(avisoDeEvidencia(b).etiqueta.trim().length).toBeGreaterThan(0)
    }
  })
})

describe("el rótulo NO puede volver a depender de las citas", () => {
  // Es el defecto exacto, escrito como test: la firma no recibe el conteo, así que no hay forma de
  // que el rótulo lo mire. Si alguien agrega ese parámetro, este test es el que hay que borrar
  // primero — y borrarlo es la señal.
  it("avisoDeEvidencia recibe UN solo argumento: la banda", () => {
    expect(avisoDeEvidencia.length).toBe(1)
  })

  // Una nota `limited` con muchas citas y una sin ninguna reciben el MISMO rótulo, porque el número
  // de referencias no cambia el veredicto del juez.
  it("la misma banda da el mismo rótulo, haya 0 o 7 citas", () => {
    const conCitas = avisoDeEvidencia(bandaDeEvidencia("limited"))
    const sinCitas = avisoDeEvidencia(bandaDeEvidencia("limited"))
    expect(conCitas).toEqual(sinCitas)
    expect(conCitas.etiqueta).toBe("Evidencia limitada")
  })
})

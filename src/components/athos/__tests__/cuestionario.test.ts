/**
 * Cuestionario de contexto — el CONTRATO del mensaje compuesto.
 *
 * El system prompt le promete al modelo que la respuesta del vet llega como líneas
 * "Pregunta: respuesta". Si `componerRespuestas` cambia de forma, el modelo recibe otra cosa de
 * la que espera y re-pregunta lo ya respondido — este test fija ese contrato.
 */
import { describe, expect, it } from "vitest"

import { componerRespuestas } from "@/components/athos/cuestionario"

const PREGUNTAS = [
  { pregunta: "¿Cómo empezó la cojera?", opciones: ["Aguda (menos de 48 h)", "Progresiva"] },
  { pregunta: "¿Cómo está el apetito?", opciones: ["Normal", "Disminuido"] },
]

describe("componerRespuestas", () => {
  it("una línea 'Pregunta: respuesta' por pregunta, en orden", () => {
    const texto = componerRespuestas(PREGUNTAS, {
      0: { opcion: "Aguda (menos de 48 h)", libre: "" },
      1: { opcion: null, libre: "come solo si le doy en la mano" },
    })
    expect(texto).toBe(
      "¿Cómo empezó la cojera?: Aguda (menos de 48 h)\n¿Cómo está el apetito?: come solo si le doy en la mano",
    )
  })

  it("el texto libre viaja recortado de espacios", () => {
    const texto = componerRespuestas([PREGUNTAS[0]], { 0: { opcion: null, libre: "  ayer  " } })
    expect(texto).toBe("¿Cómo empezó la cojera?: ayer")
  })

  it("formato viejo (pregunta vacía = tanda de un solo grupo): viaja la respuesta sola", () => {
    const texto = componerRespuestas([{ pregunta: "", opciones: ["Sí", "No"] }], {
      0: { opcion: "Sí", libre: "" },
    })
    expect(texto).toBe("Sí")
  })
})

// La espera viva: los umbrales de fraseDeEspera son producto (la frase que cambia ES la señal de
// que no está colgado). Si alguien los aplana a una sola frase, esto se pone rojo.
import { fraseDeEspera } from "@/components/athos/pensando"

describe("fraseDeEspera — la frase evoluciona con la espera", () => {
  it("arranca pensando y termina agradeciendo la paciencia", () => {
    expect(fraseDeEspera(0)).toBe("Athos está pensando…")
    expect(fraseDeEspera(10)).toBe("Armando la respuesta…")
    expect(fraseDeEspera(25)).toContain("respuesta completa")
    expect(fraseDeEspera(60)).toContain("paciencia")
  })
  it("las cuatro fases son DISTINTAS (el cambio es la señal de vida)", () => {
    const fases = [fraseDeEspera(0), fraseDeEspera(10), fraseDeEspera(25), fraseDeEspera(60)]
    expect(new Set(fases).size).toBe(4)
  })
})

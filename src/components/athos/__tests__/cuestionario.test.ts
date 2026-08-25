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

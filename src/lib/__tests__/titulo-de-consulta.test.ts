// Cómo se llama una consulta.
//
// El "motivo de consulta" sale del inicio (decisión del 17-ago) y el título pasa a derivarse de la
// nota SOAP, como propuso Jesús: cuando la consulta terminó ya se sabe de qué fue.
//
// LO QUE ESTOS TESTS PROTEGEN es que la lista de consultas siga siendo legible. Un derivador que
// devuelve la misma muletilla para todo, o fragmentos de tres letras, convierte la lista en una
// columna de ruido — y eso no rompe nada, sólo deja de servir.

import { describe, expect, it } from "vitest"

import {
  MAX_TITULO,
  derivarTitulo,
  tituloDeLaConsulta,
} from "@/lib/consultas/titulo"

// La evaluación real que el sistema le escribió a Manchita el 17-ago.
const MANCHITA =
  "Cuadro clínico compatible con vómitos crónicos (duración >1 semana) en gato, con posibles " +
  "diagnósticos diferenciales que incluyen cuerpo extraño gastrointestinal (antecedente de cuerda), " +
  "enfermedad inflamatoria intestinal, enfermedad renal crónica, o trastornos metabólicos."

describe("derivar el título de un texto clínico", () => {
  it("de la evaluación de Manchita sale de qué fue la consulta", () => {
    const t = derivarTitulo(MANCHITA)
    expect(t).toContain("Vómitos crónicos")
    expect(t!.length).toBeLessThanOrEqual(MAX_TITULO + 1) // +1 por el "…"
  })

  // SIN ESTO LA LISTA ES UNA COLUMNA DE LA MISMA FRASE: cuarenta consultas empezando con "Cuadro
  // clínico compatible con" no distinguen ninguna.
  it("recorta las muletillas con las que arranca el modelo", () => {
    for (const muletilla of [
      "Cuadro clínico compatible con ",
      "Compatible con ",
      "Sugestivo de ",
      "Se observan ",
      "El paciente presenta ",
      "Hallazgos compatibles con ",
      "Impresión diagnóstica: ",
    ]) {
      expect(derivarTitulo(`${muletilla}otitis externa por Malassezia`)).toBe(
        "Otitis externa por Malassezia",
      )
    }
  })

  it("corta en la primera oración, no en el párrafo entero", () => {
    expect(derivarTitulo("Dermatitis alérgica por pulgas. Se indica control en 15 días.")).toBe(
      "Dermatitis alérgica por pulgas",
    )
  })

  // "1.5 mg" y "Dr. Pérez" no son finales de oración: partir ahí trunca a la mitad de una cifra.
  it("un punto que no cierra oración no corta", () => {
    expect(derivarTitulo("Intoxicación por 1.5 mg de permetrina en gato")).toBe(
      "Intoxicación por 1.5 mg de permetrina en gato",
    )
  })

  it("recorta largo sin partir palabras", () => {
    const largo = derivarTitulo("Enfermedad " + "renal ".repeat(30))!
    expect(largo.length).toBeLessThanOrEqual(MAX_TITULO + 1)
    expect(largo).toMatch(/…$/)
    expect(largo).not.toMatch(/\s…$/) // no queda un espacio colgando antes de los puntos
  })

  it("pone mayúscula inicial sin tocar el resto", () => {
    expect(derivarTitulo("compatible con IBD felina crónica")).toBe("IBD felina crónica")
    expect(derivarTitulo("vómitos crónicos en gato")).toBe("Vómitos crónicos en gato")
  })

  // Mejor caer al siguiente candidato que titular con ruido.
  it("con menos de tres palabras no hay título", () => {
    expect(derivarTitulo("en gato")).toBeNull()
    expect(derivarTitulo("Compatible con gastritis")).toBeNull() // quedan 1 palabra tras la muletilla
    expect(derivarTitulo("")).toBeNull()
    expect(derivarTitulo("   ")).toBeNull()
    expect(derivarTitulo(null)).toBeNull()
    expect(derivarTitulo(undefined)).toBeNull()
  })
})

describe("el título de la consulta, en orden de preferencia", () => {
  it("el motivo escrito a mano manda: es lo que el vet decidió llamarle", () => {
    expect(
      tituloDeLaConsulta({ chiefComplaint: "Control de vacunas", assessment: MANCHITA }),
    ).toBe("Control de vacunas")
  })

  // Hay meses de consultas con el motivo escrito a mano: no se les cambia el nombre por detrás.
  it("un motivo largo se recorta pero sigue mandando", () => {
    const t = tituloDeLaConsulta({ chiefComplaint: "x".repeat(200) })
    expect(t.length).toBeLessThanOrEqual(MAX_TITULO + 1)
  })

  it("sin motivo, manda la evaluación", () => {
    expect(tituloDeLaConsulta({ assessment: MANCHITA })).toContain("Vómitos crónicos")
  })

  it("con la evaluación inservible, cae a lo relatado", () => {
    expect(
      tituloDeLaConsulta({
        assessment: "Sin hallazgos",
        subjective: "Vómito amarillo espumoso desde hace dos semanas",
      }),
    ).toBe("Vómito amarillo espumoso desde hace dos semanas")
  })

  // Es lo honesto: la consulta acaba de empezar, no hay nota y nadie escribió nada.
  it("sin nada, se llama Consulta", () => {
    expect(tituloDeLaConsulta({})).toBe("Consulta")
    expect(tituloDeLaConsulta({ chiefComplaint: "  ", assessment: "", subjective: null })).toBe(
      "Consulta",
    )
  })
})

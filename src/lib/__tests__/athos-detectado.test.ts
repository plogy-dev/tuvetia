// Qué paciente resolvió Athos por su cuenta.
//
// LO QUE ESTOS TESTS PROTEGEN es la honestidad del indicador. Un chip que dice "Athos está usando
// Manchita" cuando en realidad no eligió ninguna de las tres Manchitas que encontró es peor que no
// tener chip: es la objeción exacta que Jesús puso en la reunión —"si tú tienes 7 perros que tienen
// leucemia… llegas a dar un mal diagnóstico"— servida por la interfaz.

import { describe, expect, it } from "vitest"

import {
  discrepa,
  pacienteDetectado,
  type MensajeConPartes,
} from "@/lib/athos-context/detectado"

const MANCHITA = { id: "11111111-1111-4111-8111-111111111111", name: "Manchita", species: "Gato" }
const ROCKY = { id: "22222222-2222-4222-8222-222222222222", name: "Rocky", species: "Perro" }

/** Un turno del asistente que abrió la ficha de un paciente. */
function ficha(p: typeof MANCHITA): MensajeConPartes {
  return {
    role: "assistant",
    parts: [
      { type: "tool-get_patient_summary", state: "output-available", output: { patient: p, allergies: [] } },
    ],
  }
}

/** Un turno del asistente que buscó pacientes y encontró los que se le pasen. */
function busqueda(...ps: (typeof MANCHITA)[]): MensajeConPartes {
  return {
    role: "assistant",
    parts: [
      {
        type: "tool-search_patients",
        state: "output-available",
        output: { count: ps.length, patients: ps },
      },
    ],
  }
}

describe("no hay nada que afirmar", () => {
  it("sin mensajes", () => {
    expect(pacienteDetectado([])).toBeNull()
    expect(pacienteDetectado(undefined)).toBeNull()
  })

  it("una conversación de puro texto no detecta nada", () => {
    expect(
      pacienteDetectado([
        { role: "user", parts: [{ type: "text" }] },
        { role: "assistant", parts: [{ type: "text" }] },
      ]),
    ).toBeNull()
  })

  it("una herramienta EN CURSO no cuenta: todavía no hay salida", () => {
    expect(
      pacienteDetectado([
        { role: "assistant", parts: [{ type: "tool-search_patients", state: "input-available" }] },
      ]),
    ).toBeNull()
  })

  it("una herramienta que FALLÓ no cuenta", () => {
    expect(
      pacienteDetectado([
        { role: "assistant", parts: [{ type: "tool-get_patient_summary", state: "output-error" }] },
      ]),
    ).toBeNull()
  })

  it("otras herramientas de lectura no dicen nada del paciente", () => {
    expect(
      pacienteDetectado([
        {
          role: "assistant",
          parts: [
            { type: "tool-search_clinical_evidence", state: "output-available", output: { chunks: [] } },
            { type: "tool-get_clinic_hours", state: "output-available", output: { hours: [] } },
          ],
        },
      ]),
    ).toBeNull()
  })
})

describe("lo detecta cuando Athos lo resolvió de verdad", () => {
  it("abrir la ficha es un hecho, no una inferencia", () => {
    const d = pacienteDetectado([ficha(MANCHITA)])
    expect(d).toEqual({
      id: MANCHITA.id,
      nombre: "Manchita",
      especie: "Gato",
      via: "ficha",
    })
  })

  it("una búsqueda con UNA sola coincidencia sí resuelve", () => {
    const d = pacienteDetectado([busqueda(MANCHITA)])
    expect(d?.nombre).toBe("Manchita")
    expect(d?.via).toBe("busqueda")
  })

  // LA REGLA QUE MÁS IMPORTA, y es la objeción de Jesús hecha código.
  it("una búsqueda AMBIGUA no resuelve nada", () => {
    expect(pacienteDetectado([busqueda(MANCHITA, ROCKY)])).toBeNull()
  })

  it("una búsqueda sin resultados tampoco", () => {
    expect(pacienteDetectado([busqueda()])).toBeNull()
  })
})

describe("gana lo más reciente: el contexto se mueve con la conversación", () => {
  it("de Manchita a Rocky, vale Rocky", () => {
    expect(pacienteDetectado([ficha(MANCHITA), ficha(ROCKY)])?.nombre).toBe("Rocky")
  })

  it("dentro de un mismo turno también manda la última parte", () => {
    const turno: MensajeConPartes = {
      role: "assistant",
      parts: [...ficha(MANCHITA).parts!, ...ficha(ROCKY).parts!],
    }
    expect(pacienteDetectado([turno])?.nombre).toBe("Rocky")
  })

  it("una búsqueda ambigua posterior NO borra la ficha ya abierta", () => {
    // Athos abrió la ficha de Manchita y después buscó y encontró varios: sigue trabajando con
    // Manchita, que es lo último que resolvió de verdad.
    expect(pacienteDetectado([ficha(MANCHITA), busqueda(MANCHITA, ROCKY)])?.nombre).toBe("Manchita")
  })
})

describe("salidas mal formadas no rompen ni inventan", () => {
  it("una ficha sin id o sin nombre no se usa", () => {
    for (const output of [
      { patient: { name: "Manchita" } },
      { patient: { id: MANCHITA.id } },
      { patient: null },
      { patient: "Manchita" },
      null,
      "texto suelto",
    ]) {
      expect(
        pacienteDetectado([
          { role: "assistant", parts: [{ type: "tool-get_patient_summary", state: "output-available", output }] },
        ]),
        `no debería resolver con ${JSON.stringify(output)}`,
      ).toBeNull()
    }
  })

  it("la especie puede faltar sin invalidar la detección", () => {
    const d = pacienteDetectado([
      {
        role: "assistant",
        parts: [
          {
            type: "tool-get_patient_summary",
            state: "output-available",
            output: { patient: { id: MANCHITA.id, name: "Manchita" } },
          },
        ],
      },
    ])
    expect(d?.nombre).toBe("Manchita")
    expect(d?.especie).toBeNull()
  })

  it("un nombre en blanco no cuenta como nombre", () => {
    expect(
      pacienteDetectado([
        {
          role: "assistant",
          parts: [
            {
              type: "tool-get_patient_summary",
              state: "output-available",
              output: { patient: { id: MANCHITA.id, name: "   " } },
            },
          ],
        },
      ]),
    ).toBeNull()
  })
})

describe("cuándo hay que avisarle al vet", () => {
  const detectado = { id: MANCHITA.id, nombre: "Manchita", especie: "Gato", via: "ficha" } as const

  it("sin detección no hay nada que resolver", () => {
    expect(discrepa(ROCKY.id, null)).toBe(false)
    expect(discrepa(null, null)).toBe(false)
  })

  it("si coinciden, no se avisa", () => {
    expect(discrepa(MANCHITA.id, detectado)).toBe(false)
  })

  // Los dos casos peligrosos: el selector dice otra cosa, o no dice nada.
  it("el selector apunta a OTRO paciente", () => {
    expect(discrepa(ROCKY.id, detectado)).toBe(true)
  })

  it("el selector está en consulta general", () => {
    expect(discrepa(null, detectado)).toBe(true)
  })
})

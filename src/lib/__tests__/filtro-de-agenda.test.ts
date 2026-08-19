// De quién son las citas que se ven en la agenda.
//
// LO QUE ESTOS TESTS PROTEGEN es que no desaparezca una cita. Un filtro de agenda que esconde de
// más no falla ruidosamente: la pantalla se ve prolija y el vet simplemente no va.

import { describe, expect, it } from "vitest"

import { citasVisibles, deOtros, sinAsignar } from "@/lib/agenda/filtro"

const YO = "yo-uuid"
const OTRO = "otro-uuid"

const CITAS = [
  { id: "a", vet_id: YO },
  { id: "b", vet_id: OTRO },
  { id: "c", vet_id: null },
  { id: "d", vet_id: YO },
]

const ids = (cs: { id: string }[]) => cs.map((c) => c.id)

describe("el interruptor", () => {
  it("la clínica entera muestra todo", () => {
    expect(ids(citasVisibles(CITAS, "clinica", YO))).toEqual(["a", "b", "c", "d"])
  })

  it("mi agenda esconde las de otros", () => {
    expect(ids(citasVisibles(CITAS, "mia", YO))).not.toContain("b")
  })

  // LA DECISIÓN QUE NO ES OBVIA. Escondida, una cita sin asignar no aparece en la vista por defecto
  // de NADIE — y una cita que nadie mira es una cita a la que no va nadie.
  it("mi agenda SÍ muestra las que no son de nadie", () => {
    expect(ids(citasVisibles(CITAS, "mia", YO))).toEqual(["a", "c", "d"])
  })

  // Una agenda vacía se lee como "no tengo nada hoy", que es lo más caro que puede mentir esta
  // pantalla. Ante un dato que no llegó, mostrar de más.
  it("sin saber quién soy, no se esconde nada", () => {
    expect(ids(citasVisibles(CITAS, "mia", null))).toEqual(["a", "b", "c", "d"])
    expect(ids(citasVisibles(CITAS, "mia", undefined))).toEqual(["a", "b", "c", "d"])
  })

  it("no muta la lista original", () => {
    const copia = [...CITAS]
    citasVisibles(CITAS, "clinica", YO).pop()
    expect(CITAS).toEqual(copia)
  })

  it("una agenda vacía no rompe", () => {
    expect(citasVisibles([], "mia", YO)).toEqual([])
  })
})

describe("lo que hay que poder decir", () => {
  it("cuántas están sin asignar", () => {
    expect(sinAsignar(CITAS)).toBe(1)
    expect(sinAsignar([])).toBe(0)
  })

  // Es lo que el interruptor está escondiendo: decirlo es la diferencia entre filtrar y ocultar.
  it("cuántas son de otras personas", () => {
    expect(deOtros(CITAS, YO)).toBe(1)
  })

  it("sin saber quién soy, no hay 'otros'", () => {
    expect(deOtros(CITAS, null)).toBe(0)
  })
})

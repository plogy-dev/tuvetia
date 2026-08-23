// Qué buscar, sacado de lo que se está diciendo en la consulta.
//
// Alimenta la pestaña "Casos parecidos" del notch. Lo que estos tests protegen es que la búsqueda
// tenga con qué: si los términos salen vacíos o son palabras de relleno, la pestaña queda muda sin
// que nada falle — y el vet concluye que la clínica nunca vio un caso así.

import { describe, expect, it } from "vitest"

import { MAX_TERMINOS, terminosDeBusqueda } from "@/lib/consulta-viva/terminos"

// Un tramo real de consulta, del transcript de Manchita del 17-ago.
const CONSULTA =
  "Veterinario: Cuénteme, ¿qué le pasa a Manchita? Doctor, es que desde el 3 de agosto está " +
  "vomitando. Yo pensé que era una bola de pelo, pero ya van casi 2 semanas. ¿Cuántas veces al " +
  "día? Al principio una, ahora unas 3 o 4, y ya casi no come. ¿Y el vómito cómo es? Amarillo, " +
  "doctor, como espumoso. ¿Ha perdido peso? Sí, se siente más flaquito. Le compré un juguete con " +
  "una cuerdita hace como 3 semanas."

describe("de qué trata la consulta", () => {
  it("saca los términos que la distinguen", () => {
    const t = terminosDeBusqueda(CONSULTA)
    expect(t.length).toBeGreaterThan(0)
    // "semanas" se repite y es del caso; "doctor" se repite y no dice nada.
    expect(t).not.toContain("doctor")
  })

  it("no devuelve más de los que la búsqueda aguanta", () => {
    expect(terminosDeBusqueda(CONSULTA).length).toBeLessThanOrEqual(MAX_TERMINOS)
    expect(terminosDeBusqueda(CONSULTA, 2).length).toBeLessThanOrEqual(2)
  })

  // Lo que se repite es el motivo: si "vómito" aparece nueve veces, de eso trata la consulta.
  it("manda lo que más se repite", () => {
    const t = terminosDeBusqueda("cojera cojera cojera rotula rotula displasia")
    expect(t[0]).toBe("cojera")
  })

  // Una palabra que aparece una sola vez suele ser un error de transcripción, y buscar por un
  // error no encuentra nada.
  it("lo que aparece una sola vez no cuenta", () => {
    expect(terminosDeBusqueda("malassezia otitis externa")).toEqual([])
  })

  it("las tildes no parten la misma palabra en dos", () => {
    const t = terminosDeBusqueda("vómito vomito vómito")
    expect(t).toEqual(["vomito"])
  })

  it("las palabras cortas no sirven para buscar", () => {
    expect(terminosDeBusqueda("piel piel piel")).toEqual([])
  })

  describe("las palabras de relleno no llegan a la búsqueda", () => {
    for (const relleno of ["doctor", "gracias", "entonces", "paciente", "mascota", "semana"]) {
      it(`«${relleno}» se descarta aunque se repita`, () => {
        expect(terminosDeBusqueda(`${relleno} ${relleno} ${relleno}`)).toEqual([])
      })
    }
  })

  it("una transcripción vacía no rompe", () => {
    expect(terminosDeBusqueda("")).toEqual([])
    expect(terminosDeBusqueda("   ...   ")).toEqual([])
  })
})

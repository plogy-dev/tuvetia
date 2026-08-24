// La política de tratamiento de datos.
//
// LO QUE ESTOS TESTS IMPIDEN es publicar un documento legal incompleto. No es una preocupación
// teórica: hasta hoy `/legal/privacidad` decía "Documento en preparación" mientras el formulario de
// registro afirmaba "al crear tu cuenta, aceptas nuestra Política de privacidad" — o sea que se
// pedía aceptar un documento que no existía.
//
// La Ley 1581 exige que la política nombre un responsable con NIT y domicilio, y que cubra unos
// contenidos mínimos. Las dos cosas se verifican acá, porque son las dos formas de publicar algo que
// aparenta cumplimiento sin darlo.

import { describe, expect, it } from "vitest"

import {
  POLITICA,
  SECCIONES_OBLIGATORIAS,
  VERSION_POLITICA,
} from "@/lib/legal/politica-de-datos"
import {
  camposFaltantes,
  responsableDefinido,
  type Responsable,
} from "@/lib/legal/responsable"

const COMPLETO: Responsable = {
  razonSocial: "Ejemplo S.A.S.",
  nit: "900.123.456-7",
  domicilio: "Calle 1 # 2-3, Bogotá",
  correo: "datos@ejemplo.com",
  telefono: "+57 300 000 0000",
}

describe("la política no se publica sin responsable", () => {
  // EL GUARD. Sin él, la página renderizaría el documento con la razón social en blanco: un texto
  // que describe prácticas sin decir quién responde por ellas, y sin dirección donde reclamar.
  it("con los cinco campos, se publica", () => {
    expect(responsableDefinido(COMPLETO)).toBe(true)
  })

  it("faltando UNO SOLO, no se publica", () => {
    for (const campo of Object.keys(COMPLETO) as Array<keyof Responsable>) {
      expect(
        responsableDefinido({ ...COMPLETO, [campo]: "" }),
        `sin ${campo} el documento queda incompleto y no debería publicarse`,
      ).toBe(false)
    }
  })

  // Un espacio en blanco es tan inútil como el vacío y mucho más difícil de ver revisando.
  it("un espacio en blanco no cuenta como definido", () => {
    expect(responsableDefinido({ ...COMPLETO, nit: "   " })).toBe(false)
  })

  it("dice QUÉ falta, para no obligar a adivinarlo", () => {
    const faltan = camposFaltantes({ ...COMPLETO, nit: "", telefono: "" })
    expect(faltan).toEqual(["NIT", "teléfono"])
  })

  it("con todo definido no falta nada", () => {
    expect(camposFaltantes(COMPLETO)).toEqual([])
  })
})

describe("el contenido cubre lo que la ley exige", () => {
  it("están todas las secciones obligatorias", () => {
    const presentes = new Set(POLITICA.map((s) => s.id))
    const faltantes = SECCIONES_OBLIGATORIAS.filter((id) => !presentes.has(id))

    expect(
      faltantes,
      "la Ley 1581 y el Decreto 1074 exigen estos contenidos mínimos en la política",
    ).toEqual([])
  })

  it("ninguna sección queda vacía", () => {
    const vacias = POLITICA.filter((s) => s.bloques.length === 0).map((s) => s.id)
    expect(vacias).toEqual([])
  })

  it("los identificadores de sección son únicos: son anclas estables", () => {
    const ids = POLITICA.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // Los derechos que el artículo 8 de la Ley 1581 reconoce al titular. Que la sección exista no
  // basta: tiene que enumerarlos.
  it("la sección de derechos nombra los que la ley reconoce", () => {
    const derechos = POLITICA.find((s) => s.id === "derechos")!
    const texto = JSON.stringify(derechos).toLowerCase()

    for (const derecho of ["conocer", "actualizar", "rectificar", "revocar", "supresión", "prueba"]) {
      expect(texto, `falta el derecho a ${derecho}`).toContain(derecho)
    }
  })

  // Sin a dónde escribir y en cuánto responden, los derechos son decorativos.
  it("dice cómo ejercerlos y en qué plazo", () => {
    const derechos = JSON.stringify(POLITICA.find((s) => s.id === "derechos")).toLowerCase()
    expect(derechos).toContain("10 días hábiles")
    expect(derechos).toContain("15 días hábiles")
  })

  // El inventario de datos es lo que hace que esta política no sea una plantilla. Se comprueba que
  // nombre lo REALMENTE sensible, que es la voz del titular y su documento de identidad.
  it("el inventario declara la voz y el documento de identidad", () => {
    const datos = JSON.stringify(POLITICA.find((s) => s.id === "datos")).toLowerCase()
    expect(datos).toContain("voz")
    expect(datos).toContain("documento de identidad")
    expect(datos, "la retención de 4 días del audio es una promesa verificable").toContain("4 días")
  })

  it("la versión tiene forma de fecha, para saber qué texto se aceptó", () => {
    expect(VERSION_POLITICA).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

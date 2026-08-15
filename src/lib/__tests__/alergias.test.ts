import { describe, expect, it } from "vitest"

import { marcarAlergenos, resumenDeAlergias, type AlergiaRegistrada } from "@/lib/alergias"

const PENICILINA: AlergiaRegistrada = { allergen: "penicilina", severity: "severe" }

/** Los trozos marcados, en orden. Es lo único que la pantalla pinta en rojo. */
function marcados(texto: string, alergias: AlergiaRegistrada[] = [PENICILINA]) {
  return marcarAlergenos(texto, alergias)
    .filter((t) => t.alergeno)
    .map((t) => t.texto)
}

/** Reconstruir los trozos tiene que devolver el texto original, carácter por carácter. */
function reconstruido(texto: string, alergias: AlergiaRegistrada[] = [PENICILINA]) {
  return marcarAlergenos(texto, alergias)
    .map((t) => t.texto)
    .join("")
}

describe("marcarAlergenos", () => {
  it("marca el alérgeno cuando el plan lo menciona", () => {
    expect(marcados("Iniciar penicilina 20 mg/kg cada 12 h.")).toEqual(["penicilina"])
  })

  it("NO se enciende dentro de otra palabra que la contiene", () => {
    // El caso que importa: amoxicilina no es penicilina, y una alarma falsa acá entrena al vet a
    // ignorar el color justo en la pantalla donde no puede ignorarlo.
    expect(marcados("Amoxicilina 15 mg/kg cada 12 h.")).toEqual([])
  })

  it("coincide en plural, que es como se escribe una clase de fármaco", () => {
    expect(marcados("No usar penicilinas.")).toEqual(["penicilinas"])
  })

  it("ignora tildes y mayúsculas sin descuadrar el recorte", () => {
    const texto = "Suspender Penicilina. Vigilar la función renal."
    expect(marcados(texto)).toEqual(["Penicilina"])
    expect(reconstruido(texto)).toBe(texto)
  })

  it("conserva el texto original exacto al reconstruir los trozos", () => {
    const texto = "Día 1: penicilina. Día 2: revisión — sin penicilinas si hay reacción."
    expect(reconstruido(texto)).toBe(texto)
  })

  it("marca varias apariciones y varias alergias", () => {
    const alergias = [PENICILINA, { allergen: "cefalexina", severity: "moderate" }]
    expect(marcados("Evitar penicilina y cefalexina; penicilina está contraindicada.", alergias)).toEqual([
      "penicilina",
      "cefalexina",
      "penicilina",
    ])
  })

  it("no parte el texto cuando dos alergias se solapan", () => {
    const alergias = [
      { allergen: "penicilina", severity: "severe" },
      { allergen: "penicilina G", severity: "severe" },
    ]
    const texto = "Contraindicada la penicilina G en este paciente."
    expect(reconstruido(texto, alergias)).toBe(texto)
    // Se marca UN tramo, no dos superpuestos.
    expect(marcados(texto, alergias)).toHaveLength(1)
  })

  it("devuelve el texto entero, sin marcas, cuando no hay alergias registradas", () => {
    expect(marcarAlergenos("Iniciar penicilina.", [])).toEqual([
      { texto: "Iniciar penicilina.", alergeno: null },
    ])
  })

  it("descarta alérgenos de menos de tres letras, que marcarían media nota", () => {
    expect(marcados("Se indica ab y luego reposo.", [{ allergen: "ab", severity: "mild" }])).toEqual([])
  })

  it("no rompe con un alérgeno que trae caracteres de expresión regular", () => {
    const alergias = [{ allergen: "sulfa (cotrimoxazol)", severity: "severe" }]
    const texto = "Evitar sulfa (cotrimoxazol) por antecedente."
    expect(reconstruido(texto, alergias)).toBe(texto)
    expect(marcados(texto, alergias)).toEqual(["sulfa (cotrimoxazol)"])
  })

  it("un plan vacío no produce trozos raros", () => {
    expect(marcarAlergenos("", [PENICILINA])).toEqual([{ texto: "", alergeno: null }])
  })

  it("estira la marca para no partir una negrita ni una cita", () => {
    // `**penicilina**` es UN token para `renderInline`. Cortar por el medio dejaría "**" sueltos
    // en una nota clínica; la marca se estira y cubre el token entero.
    const texto = "Evitar **penicilina** en este paciente."
    const zonas = [{ desde: 7, hasta: 21 }]
    expect(marcarAlergenos(texto, [PENICILINA], zonas).filter((t) => t.alergeno)).toEqual([
      { texto: "**penicilina**", alergeno: PENICILINA },
    ])
    expect(
      marcarAlergenos(texto, [PENICILINA], zonas)
        .map((t) => t.texto)
        .join(""),
    ).toBe(texto)
  })

  it("devuelve la alergia completa en el trozo marcado, no sólo el nombre", () => {
    const t = marcarAlergenos("Dar penicilina.", [PENICILINA]).find((x) => x.alergeno)
    expect(t?.alergeno?.severity).toBe("severe")
  })
})

describe("resumenDeAlergias", () => {
  it("nombra el alérgeno con su severidad en español", () => {
    expect(
      resumenDeAlergias([PENICILINA, { allergen: "polen", severity: "mild" }]),
    ).toBe("penicilina (severa) · polen (leve)")
  })

  it("una severidad desconocida no imprime paréntesis vacíos", () => {
    expect(resumenDeAlergias([{ allergen: "x", severity: "rarísima" }])).toBe("x")
  })
})

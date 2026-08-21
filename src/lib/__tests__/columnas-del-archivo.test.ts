/**
 * Que la importación no cruce las columnas.
 *
 * EL REPORTE, de David el 19-ago: al importar, las columnas salen intercambiadas — y con otro
 * archivo salen intercambiadas de otra forma.
 *
 * Cada caso de acá es una planilla que el mapeo anterior arruinaba. No son hipótesis: son las tres
 * formas en que `headers.find(h => synonyms.some(s => norm(h).includes(s)))` falla — gana el
 * primero del archivo en vez del que mejor calza, `includes` no distingue "Nombre" de "Nombre del
 * titular", y los campos se sirven por turno.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  CAMPOS,
  SIN_MAPEAR,
  columnasDe,
  esDelTitular,
  mapearColumnas,
  normalizar,
  puntaje,
} from "@/lib/pacientes/columnas-del-archivo"

/** Mapea una planilla descrita por sus encabezados y devuelve campo → ETIQUETA (más legible). */
function mapearPlanilla(encabezados: string[]): Record<string, string> {
  const columnas = columnasDe(encabezados)
  const porId = new Map(columnas.map((c) => [c.id, c.etiqueta]))
  const mapa = mapearColumnas(columnas)
  const salida: Record<string, string> = {}
  for (const [campo, id] of Object.entries(mapa)) {
    salida[campo] = id === SIN_MAPEAR ? SIN_MAPEAR : (porId.get(id) ?? SIN_MAPEAR)
  }
  return salida
}

describe("el paciente no se llama como su dueño", () => {
  it("'Nombre del titular' no se lleva el campo de la mascota", () => {
    // EL CASO EMBLEMÁTICO. Antes `name` se quedaba con "Nombre del titular" —contiene "nombre"— y
    // como el encabezado ya estaba tomado, `owner_name` se quedaba vacío. El paciente terminaba
    // llamándose como su dueño Y el dueño se perdía: dos campos rotos con un solo error.
    const m = mapearPlanilla(["Nombre del titular", "Nombre", "Especie"])
    expect(m.name).toBe("Nombre")
    expect(m.owner_name).toBe("Nombre del titular")
  })

  it("da igual en qué orden vengan las columnas", () => {
    // LA RAZÓN DE QUE "CON OTRO FORMATO SALGA DISTINTO": antes ganaba el primer encabezado del
    // archivo, así que el resultado dependía de cómo estuviera armada la planilla.
    const a = mapearPlanilla(["Nombre", "Nombre del titular"])
    const b = mapearPlanilla(["Nombre del titular", "Nombre"])
    expect(a.name).toBe("Nombre")
    expect(b.name).toBe("Nombre")
    expect(a.owner_name).toBe("Nombre del titular")
    expect(b.owner_name).toBe("Nombre del titular")
  })

  it("una columna del titular nunca llena un campo de la mascota", () => {
    // Aunque no haya competencia. Sin la regla, una planilla con "Nombre del propietario" y sin
    // columna de mascota mapearía al propietario como paciente y la importación crearía 300
    // mascotas llamadas como sus dueños.
    const m = mapearPlanilla(["Nombre del propietario", "Especie", "Raza"])
    expect(m.name).toBe(SIN_MAPEAR)
    expect(m.owner_name).toBe("Nombre del propietario")
  })

  it("'Teléfono del titular' es del titular, no un teléfono suelto", () => {
    const m = mapearPlanilla(["Mascota", "Teléfono del dueño"])
    expect(m.name).toBe("Mascota")
    expect(m.owner_phone).toBe("Teléfono del dueño")
  })
})

describe("gana el que mejor calza, no el que viene primero", () => {
  it("lo exacto le gana a lo parcial", () => {
    // "Especie" es exacto; "Tipo de animal" contiene dos sinónimos sueltos. Antes ganaba el que
    // estuviera antes en el archivo.
    const m = mapearPlanilla(["Tipo de animal", "Especie", "Nombre"])
    expect(m.species).toBe("Especie")
  })

  it("dos campos no se pelean la misma columna", () => {
    const m = mapearPlanilla(["Nombre", "Mascota", "Titular"])
    // Cada uno se queda con uno, y ninguna columna se usa dos veces.
    const usadas = Object.values(m).filter((v) => v !== SIN_MAPEAR)
    expect(new Set(usadas).size).toBe(usadas.length)
  })

  it("un pedazo de palabra no alcanza para adivinar", () => {
    // "nac" vive adentro de "vacunacion", y antes eso bastaba para mapearla como fecha de
    // nacimiento. Una columna vacía se corrige en dos segundos; una mal mapeada se descubre con la
    // base ya cargada.
    const m = mapearPlanilla(["Nombre", "Vacunacion"])
    expect(m.birth_date).toBe(SIN_MAPEAR)
  })
})

describe("planillas como salen de verdad", () => {
  it("encabezados pegados: FechaNac, PesoKg", () => {
    // Exportaciones de otros sistemas. Sin partir el camelCase, "fecha nac" no calza con
    // "FechaNac" ni por palabra ni por pedazo, y una columna reconocible se quedaba sin mapear.
    const m = mapearPlanilla(["NombreMascota", "FechaNac", "PesoKg"])
    expect(m.birth_date).toBe("FechaNac")
    expect(m.weight_kg).toBe("PesoKg")
  })

  it("encabezados con guión bajo, como los de una exportación cruda", () => {
    const m = mapearPlanilla(["pet_name", "owner_name", "owner_phone"])
    expect(m.name).toBe("pet_name")
    expect(m.owner_name).toBe("owner_name")
    expect(m.owner_phone).toBe("owner_phone")
  })

  it("una planilla completa en español queda entera", () => {
    const m = mapearPlanilla([
      "Nombre",
      "Especie",
      "Raza",
      "Sexo",
      "Fecha de nacimiento",
      "Peso (Kg)",
      "Propietario",
      "Celular",
      "Correo",
      "Cédula",
    ])
    expect(m).toMatchObject({
      name: "Nombre",
      species: "Especie",
      breed: "Raza",
      sex: "Sexo",
      birth_date: "Fecha de nacimiento",
      weight_kg: "Peso (Kg)",
      owner_name: "Propietario",
      owner_phone: "Celular",
      owner_email: "Correo",
      owner_document: "Cédula",
    })
  })
})

describe("columnas repetidas y vacías", () => {
  it("dos columnas con el mismo encabezado son dos columnas", () => {
    // LA OTRA MITAD DE "MEZCLA LAS COLUMNAS", y no se arregla puntuando mejor. Las filas se armaban
    // con el TEXTO del encabezado como clave, así que un "Teléfono" repetido pisaba al anterior:
    // los datos de una columna aparecían bajo el nombre de otra.
    const cols = columnasDe(["Teléfono", "Nombre", "Teléfono"])
    expect(new Set(cols.map((c) => c.id)).size).toBe(3)
    // Y se distinguen a la vista, o el vet no puede elegir cuál quiere.
    expect(cols[2].etiqueta).not.toBe(cols[0].etiqueta)
  })

  it("una columna sin encabezado sigue siendo una columna", () => {
    const cols = columnasDe(["Nombre", "", ""])
    expect(cols).toHaveLength(3)
    expect(new Set(cols.map((c) => c.id)).size).toBe(3)
    expect(cols[1].etiqueta).toContain("2")
  })

  it("una columna sin encabezado no se mapea a nada", () => {
    const m = mapearPlanilla(["Nombre", ""])
    expect(Object.values(m).filter((v) => v !== SIN_MAPEAR)).toEqual(["Nombre"])
  })
})

describe("las piezas sueltas", () => {
  it("normalizar separa lo pegado y quita lo que no es letra", () => {
    expect(normalizar("FechaNac")).toBe("fecha nac")
    expect(normalizar("Peso (Kg)")).toBe("peso kg")
    expect(normalizar("owner_name")).toBe("owner name")
    expect(normalizar("Cédula")).toBe("cedula")
  })

  it("reconoce a las columnas del titular", () => {
    expect(esDelTitular("Nombre del dueño")).toBe(true)
    expect(esDelTitular("Propietario")).toBe(true)
    expect(esDelTitular("Nombre")).toBe(false)
    // "duena" no está: lo que importa es que no dé falsos positivos con palabras que la contengan.
    expect(esDelTitular("Adueñado")).toBe(false)
  })

  it("el puntaje distingue exacto, palabra y pedazo", () => {
    const especie = CAMPOS.find((c) => c.key === "species")!
    expect(puntaje(especie, "Especie")).toBe(3)
    expect(puntaje(especie, "Especie del paciente")).toBe(2)
    expect(puntaje(especie, "Subespecies")).toBe(1)
    expect(puntaje(especie, "Raza")).toBe(0)
  })

  it("todo campo empieza sin mapear si no hay columnas", () => {
    const m = mapearColumnas([])
    expect(Object.keys(m).sort()).toEqual(CAMPOS.map((c) => c.key).sort())
    expect(Object.values(m).every((v) => v === SIN_MAPEAR)).toBe(true)
  })
})

// ── Que la pantalla use esto y no vuelva a lo de antes ──────────────────────────────────────────

describe("la pantalla de importar", () => {
  const FUENTE = readFileSync(
    join(process.cwd(), "src", "app", "dashboard", "patients", "import", "page.tsx"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

  it("usa el mapeo por puntaje, no uno propio", () => {
    // Si alguien vuelve a escribir el auto-mapeo dentro de la página, los tests de arriba seguirían
    // pasando —prueban el módulo— y la importación volvería a cruzar columnas igual que antes.
    expect(FUENTE).toContain("mapearColumnas")
    expect(FUENTE).toContain("columnasDe")
    expect(FUENTE).not.toContain("function autoMap")
  })

  it("no indexa las filas por el texto del encabezado", () => {
    // `obj[h] = fila[i]` con `h` = texto del encabezado es lo que hacía que dos columnas con el
    // mismo título se pisaran. La forma correcta usa el id posicional de la columna.
    expect(FUENTE).toContain("obj[c.id]")
    expect(FUENTE).not.toMatch(/obj\[h\]\s*=/)
  })

  it("las opciones del select valen por columna, no por título", () => {
    // Dos columnas "Teléfono" daban dos <option> con el mismo `value`: elegir una era elegir
    // cualquiera de las dos, y React además se quejaba de la key repetida.
    expect(FUENTE).toMatch(/value=\{c\.id\}/)
  })
})

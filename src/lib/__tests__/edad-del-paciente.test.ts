/**
 * La edad del paciente, y que la lista y la ficha digan la misma.
 *
 * QUÉ PASABA. `birth_date` es una columna DATE y llega como "2026-03-01"; un string así se parsea
 * como UTC por especificación. La lista de pacientes es un componente de CLIENTE —corre en el
 * navegador del vet, en Bogotá— y la ficha es de SERVIDOR —corre en Vercel, en UTC—. La misma
 * función daba dos respuestas: un gatito nacido el 1 de marzo, mirado el 29 de agosto, figuraba
 * con 6 meses en la lista y 5 en la ficha.
 *
 * Y es justo lo que el encabezado de `age.ts` promete impedir ("única fuente de verdad para lista
 * y ficha"): el archivo nació para que no divergieran por el algoritmo, y divergían por la zona.
 *
 * En un cachorro no es cosmética: la edad en meses es lo que ordena el plan de vacunación.
 *
 * OJO CON EL ÚLTIMO TEST, que parece de más y es el que sostiene a todos los otros. Con `hoyISO`
 * explícito estas pruebas son deterministas — y por eso mismo pasarían en CI (que corre en UTC)
 * aunque alguien reintrodujera `new Date(birth)`, porque en UTC ese parseo acierta. El defecto
 * sólo aparece al oeste de Greenwich. Se fija leyendo el fuente porque no hay otra forma de verlo
 * desde un CI en UTC.
 */

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { ageInMonths, fmtAgeLong, fmtAgeShort } from "@/lib/age"

describe("la edad en meses", () => {
  it("EL CASO QUE ESTABA MAL: nacido el 1, mirado a fin de mes", () => {
    // Con `new Date("2026-03-01")` en Bogotá, el nacimiento se leía como el 28 de febrero: el mes
    // de nacimiento salía uno antes y la resta del día ya no lo compensaba.
    expect(ageInMonths("2026-03-01", "2026-08-29")).toBe(5)
    expect(fmtAgeShort("2026-03-01", "2026-08-29")).toBe("5 m")
  })

  it("y la lista y la ficha coinciden, que es el punto del archivo", () => {
    // Mismo paciente, mismo día, las dos superficies. Antes esto podía discrepar sin que nadie
    // tocara el algoritmo: bastaba con que una corriera en el navegador y la otra en Vercel.
    const meses = ageInMonths("2026-03-01", "2026-08-29")
    expect(fmtAgeShort("2026-03-01", "2026-08-29")).toBe(`${meses} m`)
    expect(fmtAgeLong("2026-03-01", "2026-08-29")).toBe(`${meses} meses`)
  })

  it("todavía no cumple el mes: el día manda", () => {
    expect(ageInMonths("2026-03-15", "2026-08-14")).toBe(4)
    expect(ageInMonths("2026-03-15", "2026-08-15")).toBe(5)
  })

  it("cruza el año sin perder meses", () => {
    expect(ageInMonths("2025-11-20", "2026-08-21")).toBe(9)
    expect(ageInMonths("2015-03-10", "2026-08-21")).toBe(137)
  })

  it("recién nacido y futuro", () => {
    expect(ageInMonths("2026-08-21", "2026-08-21")).toBe(0)
    expect(fmtAgeShort("2026-08-21", "2026-08-21")).toBe("< 1 m")
    // Una fecha por venir no es una edad negativa: es un dato que no sirve.
    expect(ageInMonths("2027-01-01", "2026-08-21")).toBeNull()
  })

  it("sin fecha, o con basura, no revienta ni inventa", () => {
    expect(ageInMonths(null, "2026-08-21")).toBeNull()
    expect(ageInMonths("no es una fecha", "2026-08-21")).toBeNull()
    expect(fmtAgeShort(null, "2026-08-21")).toBe("—")
    expect(fmtAgeLong(null, "2026-08-21")).toBeNull()
  })

  it("los formatos que ve el vet", () => {
    expect(fmtAgeShort("2025-08-21", "2026-08-21")).toBe("1 a")
    expect(fmtAgeLong("2025-08-21", "2026-08-21")).toBe("1 año")
    expect(fmtAgeLong("2022-04-21", "2026-08-21")).toBe("4 a 4 m")
    expect(fmtAgeLong("2026-07-21", "2026-08-21")).toBe("1 mes")
  })

  it("NO construye un Date con la fecha de nacimiento", () => {
    const fuente = readFileSync(join(process.cwd(), "src", "lib", "age.ts"), "utf8")
    expect(fuente).not.toMatch(/new Date\(\s*birth/)
    // Y "hoy" sale de Bogotá, no de la zona en que toque correr.
    expect(fuente).toMatch(/bogotaTodayISO\(\)/)
  })
})

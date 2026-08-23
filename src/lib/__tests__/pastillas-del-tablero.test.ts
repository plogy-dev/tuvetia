/**
 * Que el detalle de una pastilla no contradiga a la cifra que lo abrió.
 *
 * QUÉ PROTEGE. El tablero cuenta con un juego de filtros y el endpoint del detalle lista con otro.
 * Son dos archivos distintos, y nada obliga a que sigan de acuerdo: el día que alguien afine el
 * conteo de citas —agregar un estado, cambiar la ventana— y no toque el endpoint, la tarjeta va a
 * decir 9 y la vista rápida va a mostrar 11. Ese desacuerdo es peor que no tener la vista: una
 * cifra que se contradice a sí misma al tocarla deja de ser creíble entera.
 *
 * ES UN TEST QUE LEE EL FUENTE, como los de contraste y foco. No hay infraestructura de tests de
 * componentes acá (vitest corre en `node` y sólo toma `src/**\/*.test.ts`), y aunque la hubiera,
 * esto no es una regla de comportamiento sino un acuerdo entre dos archivos.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

/**
 * Quita los comentarios antes de buscar. Sin esto, este mismo archivo se rompería al documentarse:
 * los comentarios de las tres fuentes citan los filtros que hay que respetar, y el escáner los
 * leería como código. `[^:]` antes de las dos barras protege a `https://`.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function leer(ruta: string): string {
  return sinComentarios(readFileSync(join(RAIZ, ruta), "utf8"))
}

const TABLERO = leer("app/dashboard/tablero/page.tsx")
const DETALLE = leer("app/api/tablero/detalle/route.ts")
const VISTA = leer("components/dashboard/vista-de-la-pastilla.tsx")
const PACIENTES = leer("app/dashboard/patients/page.tsx")

/**
 * Las claves que las páginas le pasan a sus pastillas.
 *
 * SON DOS PANTALLAS desde el 22-ago: el tablero y Pacientes. Se escanean juntas a propósito — el
 * acuerdo que este archivo protege es "toda cifra que se abre tiene quién la responda", y no
 * depende de en qué pantalla esté.
 */
function clavesDelTablero(): string[] {
  return [TABLERO, PACIENTES].flatMap((f) =>
    [...f.matchAll(/metrica:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]),
  )
}

/** Las claves que el endpoint sabe atender. */
function clavesDelEndpoint(): string[] {
  return [...DETALLE.matchAll(/metrica === "([a-z0-9-]+)"/g)].map((m) => m[1])
}

/** El cuerpo de una rama del endpoint, para mirarle los filtros. */
function ramaDelEndpoint(clave: string): string {
  const desde = DETALLE.indexOf(`metrica === "${clave}"`)
  expect(desde, `el endpoint no atiende "${clave}"`).toBeGreaterThan(-1)
  const siguiente = DETALLE.indexOf('metrica === "', desde + 1)
  return DETALLE.slice(desde, siguiente === -1 ? undefined : siguiente)
}

describe("las pastillas del tablero y su detalle", () => {
  it("cada pastilla de la página tiene quién le responda el detalle", () => {
    const enPagina = clavesDelTablero()
    // Si esto queda en cero, el resto del archivo pasa sin mirar nada.
    expect(enPagina.length).toBeGreaterThanOrEqual(8)
    const enEndpoint = clavesDelEndpoint()
    for (const clave of enPagina) {
      expect(enEndpoint, `la pastilla "${clave}" abre una vista que el endpoint no sabe llenar`).toContain(
        clave,
      )
    }
  })

  it("la vista sabe a dónde lleva cada una", () => {
    // Sin destino, la fila se dibuja pero no lleva a ningún lado — o peor, revienta al indexar.
    for (const clave of clavesDelTablero()) {
      expect(VISTA, `"${clave}" no tiene destino en DESTINOS`).toMatch(
        new RegExp(`["']?${clave}["']?:\\s*\\{`),
      )
    }
  })

  it("las citas de la vista son las mismas que cuenta la cifra", () => {
    // Los tres estados que hacen que una cita futura sea "próxima". Una cita de mañana marcada
    // completed o no_show no lo es, y por eso ninguno de los dos lados la puede contar.
    const ESTADOS = `.in("status", ["scheduled", "confirmed", "in_progress"])`
    expect(TABLERO).toContain(ESTADOS)
    expect(ramaDelEndpoint("citas-7d")).toContain(ESTADOS)

    // Y la misma ventana: desde ahora hasta dentro de siete días.
    expect(ramaDelEndpoint("citas-7d")).toContain('.gte("starts_at"')
    expect(ramaDelEndpoint("citas-7d")).toContain('.lte("starts_at"')
    expect(DETALLE).toContain("7 * 864e5")
    expect(TABLERO).toContain("7 * 864e5")
  })

  it("las notas por revisar son las mismas de los dos lados", () => {
    const BORRADOR = `.eq("status", "draft")`
    expect(TABLERO).toContain(BORRADOR)
    expect(ramaDelEndpoint("notas-borrador")).toContain(BORRADOR)
  })

  it("las consultas del mes arrancan el mismo día de los dos lados", () => {
    // `new Date(año, mes, 1)` — el primero del mes en curso, no "hace 30 días".
    const PRIMERO_DEL_MES = "getMonth(), 1)"
    expect(TABLERO).toContain(PRIMERO_DEL_MES)
    expect(DETALLE).toContain(PRIMERO_DEL_MES)
    expect(ramaDelEndpoint("consultas-mes")).toContain('.gte("started_at"')
  })

  it("el detalle es una vista, no una redirección", () => {
    // La corrección de Luciano del 19-ago: "no que te full redireccione, sino que simplemente sea
    // como una vista más directa". Si la tarjeta vuelve a ser un enlace, la vista rápida deja de
    // existir aunque el archivo siga estando.
    const TARJETA = leer("components/ui/stat-card.tsx")
    expect(TARJETA).toContain("onVer")
    // `href` A SECAS, no `href=`: la primera versión de este chequeo buscaba el atributo JSX y se
    // dejaba pasar `{...(onVer ? { href: "…" } : {})}`, que es exactamente la forma en que la
    // tarjeta volvería a navegar. La tarjeta de cifra no enlaza a ningún lado, punto.
    expect(TARJETA).not.toContain("href")
    expect(TARJETA).not.toContain("next/link")
    // Y las páginas tienen que pasarle las pastillas al componente que abre la vista. Pacientes
    // usaba `<StatCard>` suelto —cifras que no se podían tocar—, que es el estado al que no hay
    // que volver.
    expect(TABLERO).toContain("<PastillasDelTablero")
    expect(PACIENTES).toContain("<PastillasDelTablero")
    expect(PACIENTES).not.toContain("<StatCard")
  })

  it("los pacientes activos excluyen a los fallecidos de los dos lados", () => {
    // La tarjeta SIEMPRE dijo "Pacientes activos" y contaba todos. Hoy no se nota porque no hay
    // ninguno marcado; el día que lo haya, la cifra habría empezado a mentir sin que nada fallara.
    expect(PACIENTES).toMatch(/is_deceased["']?,\s*false/)
    expect(ramaDelEndpoint("pacientes-activos")).toMatch(/is_deceased["']?,\s*false/)
  })

  it("las consultas en revisión miran la consulta, no la nota", () => {
    // Es parecida a `notas-borrador` del tablero y NO es lo mismo: aquélla mira
    // `clinical_notes.status`, ésta `consultations.status`. Confundirlas daría dos cifras que se
    // parecen y no coinciden.
    const rama = ramaDelEndpoint("consultas-revision")
    expect(rama).toContain('from("consultations")')
    expect(rama).toMatch(/status["']?,\s*["']review["']/)
  })

  it("las citas de Pacientes son las de HOY, no las de siete días", () => {
    // La ventana del tablero es de 7 días y la de esta pantalla es el día. Reusar la métrica del
    // tablero habría sido lo cómodo y habría mostrado once citas bajo una cifra que dice tres.
    const rama = ramaDelEndpoint("citas-hoy")
    expect(rama).toContain("inicioDelDia")
    expect(rama).toContain("finDelDia")
    expect(rama).not.toContain("enSieteDias")
  })

  it("el endpoint rechaza una métrica que no conoce", () => {
    // Sin esto, una clave inventada caería en la última rama y devolvería la lista de otra cosa.
    expect(DETALLE).toMatch(/status:\s*400/)
  })

  it("el endpoint exige sesión", () => {
    // La RLS es la que acota por clínica, y sin usuario no hay RLS que valga: 401 antes de leer.
    expect(DETALLE).toContain("auth.getUser()")
    expect(DETALLE).toMatch(/status:\s*401/)
  })
})

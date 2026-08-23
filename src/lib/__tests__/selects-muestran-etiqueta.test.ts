// Un `<Select>` cerrado tiene que mostrar la ETIQUETA, no el valor.
//
// EL BUG, REPORTADO DESDE PRODUCCIÓN EL 2026-08-17. El formulario de citas mostraba esto:
//
//     Paciente:     20a66a41-0244-4fb2-aaed-f3d02aa22a4b
//     Titular:      dc78c9e6-d9f3-41a…
//     Veterinario:  dac5d72e-dcc5-4e…
//
// LA CAUSA está documentada en el propio Base UI, en la prop `items` de `Select.Root`:
//
//     "Data structure of the items rendered in the select popup. When specified,
//      `<Select.Value>` renders the label of the selected item instead of the raw value."
//
// O sea: **sin `items`, el select cerrado pinta el valor crudo.** Con opciones cuyo valor es un
// uuid, eso es un uuid en pantalla. Y con valores legibles el defecto es más traicionero porque
// parece que funciona: se veía "female" donde debía decir "Hembra" y "vet" donde iba "Veterinario".
//
// Estaban afectados SEIS selects en cuatro archivos. El de pacientes ya pasaba `items` y andaba
// bien, lo que confirma cuál es la vía correcta.
//
// POR QUÉ UN TEST DE FUENTE. Porque esto no lo falla ningún test de componente: el select renderiza
// sin error, sólo que con el texto equivocado. Es la misma clase de regla que el contraste de los
// tokens y el anillo de foco — se verifica leyendo el código, o no se verifica.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

/** `<SelectValue />` autocerrado: no lleva hijos, así que depende de `items` para resolver. */
const VALUE_PELADO = /<SelectValue\s*\/>/g
/** `items={…}` en el `<Select>` que lo contiene. */
const ITEMS = /items=\{/g

/**
 * Quita los comentarios antes de contar. SIN ESTO, DOCUMENTAR LA REGLA LA ROMPE: un comentario
 * que explique por qué hace falta `items` casi siempre nombra un `<SelectValue />`, el escáner lo
 * cuenta como un select más, y el archivo aparece incompleto por haberse explicado bien. Pasó el
 * 22-ago en `team-settings.tsx`. Es la misma cura que el test de las pastillas del tablero.
 *
 * El `[^:]` antes de las dos barras protege a `https://`.
 */
function sinComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function fuentes(): { ruta: string; contenido: string }[] {
  return readdirSync(RAIZ, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({
      ruta: f.replace(/\\/g, "/"),
      contenido: sinComentarios(readFileSync(join(RAIZ, f), "utf8")),
    }))
    // El wrapper define el componente; no lo usa.
    .filter((a) => !a.ruta.endsWith("ui/select.tsx"))
}

const ARCHIVOS = fuentes()

describe("los selects resuelven su etiqueta", () => {
  it("hay selects que revisar (si no, el test no mide nada)", () => {
    const conSelect = ARCHIVOS.filter((a) => a.contenido.includes("<SelectValue"))
    expect(conSelect.length).toBeGreaterThan(2)
  })

  // LA REGLA. Se cuenta por archivo y no por select porque un JSX multilínea no se parsea con una
  // expresión regular sin equivocarse: si un archivo tiene tres `<SelectValue />` pelados, tiene que
  // pasar `items` al menos tres veces. Es aproximado hacia el lado seguro — nunca deja pasar un
  // select sin resolver, y a lo sumo pide un `items` de más.
  it("todo `<SelectValue />` sin hijos tiene su `items` en el mismo archivo", () => {
    const incompletos = ARCHIVOS.map((a) => ({
      ruta: a.ruta,
      pelados: (a.contenido.match(VALUE_PELADO) ?? []).length,
      items: (a.contenido.match(ITEMS) ?? []).length,
    }))
      .filter((x) => x.pelados > x.items)
      .map((x) => `${x.ruta} — ${x.pelados} <SelectValue /> y ${x.items} items`)

    expect(
      incompletos,
      "Base UI documenta que sin `items` el select cerrado renderiza el VALOR CRUDO. Pasá " +
        "`items={[{ label, value }, …]}` al <Select>, o dale hijos al <SelectValue> que resuelvan " +
        "la etiqueta (como hace calendar-chrome.tsx).",
    ).toEqual([])
  })
})

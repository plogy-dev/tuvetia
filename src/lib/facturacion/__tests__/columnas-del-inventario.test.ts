/**
 * Las columnas del inventario, en el orden de OkVet.
 *
 * ── DE DÓNDE SALE EL ORDEN ────────────────────────────────────────────────────────────────────
 *
 * Del inventario de OkVet, mirado con la cuenta del cliente el 24-ago. Sus columnas son, exactas:
 *
 *   Opciones · Ref. · Grupo · Categoría · Nombre · Tipo · Inv. · Disponibles · Pick. · P.V. ·
 *   Impuestos · Creado
 *
 * El cliente pidió cinco de ellas por nombre —«referencia, grupo, categoría, nombre, tipo»— y el
 * motivo es de adopción, no de gusto: los veterinarios ya saben leer esa tabla. Una columna movida
 * de sitio es una que hay que volver a buscar.
 *
 * ── POR QUÉ UN TEST Y NO CONFIANZA ────────────────────────────────────────────────────────────
 *
 * Un orden de columnas es de lo más fácil de alterar sin querer: se agrega una al final, se mueve
 * otra «que queda mejor acá», y a los tres cambios la tabla ya no se parece. Este test no opina
 * sobre cuál es el orden bueno — fija el que se acordó, y obliga a que cambiarlo sea una decisión y
 * no un descuido.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

/**
 * El fuente SIN comentarios.
 *
 * El archivo lleva escrito el orden de OkVet en prosa —«Opciones · Ref. · Grupo …»— así que
 * escanear el texto crudo encuentra primero la explicación y no la tabla. Es el mismo falso
 * positivo que ya mordió al cerrojo de los embeds, al del correo y al de la factura pública.
 *
 * Se quitan BLOQUES enteros y no líneas sueltas: el comentario de esa tabla es un `{/* … *\/}`
 * de varias líneas, y sus líneas de continuación no empiezan con ningún marcador — filtrando por
 * el inicio de línea se colaban enteras.
 */
const FUENTE = readFileSync("src/components/facturacion/CatalogItemsTab.tsx", "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "")

/** Las de OkVet que sí tenemos dato para llenar, en su orden. */
const COLUMNAS = ["Opciones", "Ref.", "Grupo", "Categoría", "Nombre", "Tipo", "P.V.", "Impuestos"]

/** Los `<th>` de la tabla, en el orden en que aparecen en el fuente. */
function encabezados(): string[] {
  return [...FUENTE.matchAll(/<th[^>]*>\s*([^<{]+?)\s*(?:<\/th>|\n)/g)]
    .map((m) => m[1].trim())
    .filter(Boolean)
}

describe("las columnas del inventario", () => {
  it("están todas las que el cliente pidió por nombre", () => {
    // «referencia, grupo, categoría, nombre, tipo» — las cinco del documento del 24-ago.
    for (const c of ["Ref.", "Grupo", "Categoría", "Nombre", "Tipo"]) {
      expect(encabezados(), `falta la columna «${c}»`).toContain(c)
    }
  })

  it("VAN EN EL ORDEN DE LA REFERENCIA", () => {
    const enTabla = encabezados().filter((c) => COLUMNAS.includes(c))
    expect(enTabla).toEqual(COLUMNAS)
  })

  it("«Opciones» va primera, como en la referencia", () => {
    // En OkVet la columna de acciones abre la fila; acá estaba al final. Es lo primero que la vista
    // busca cuando ya sabe qué ítem quiere tocar.
    expect(encabezados()[0]).toBe("Opciones")
  })

  it("«P.V.» lleva su nombre completo encima", () => {
    // Es la etiqueta de OkVet y se conserva, pero abreviada sola no la entiende quien nunca lo usó.
    const i = FUENTE.indexOf("P.V.")
    expect(FUENTE.slice(Math.max(0, i - 200), i)).toContain('title="Precio de venta"')
  })

  it("no se cuelan las columnas de existencias", () => {
    // «Inv.», «Disponibles» y «Pick.» son de OkVet y NO se copian: las existencias viven en su
    // propia pantalla, y tenerlas en dos sitios es tenerlas diciendo cosas distintas.
    for (const c of ["Inv.", "Disponibles", "Pick."]) {
      expect(encabezados(), `«${c}» duplicaría el dato de existencias`).not.toContain(c)
    }
  })
})

/**
 * Los cuatro ajustes de jerarquía que pidió David el 25-ago.
 *
 * Comparten una idea: **lo que se usa va adelante, lo que se configura una vez va al fondo.** Y
 * comparten una debilidad: son de ORDEN, o sea de lo más fácil de deshacer sin querer. Alguien
 * agrega una columna al final, mueve un bloque «para que se vea antes», y a los tres cambios la
 * pantalla volvió a ser la de antes sin que nadie tomara la decisión.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const sinComentarios = (ruta: string) =>
  readFileSync(ruta, "utf8")
    // Los archivos del repo están en CRLF: sin normalizar, cualquier patrón con salto de línea
    // no matchea y el test pasa en verde sin leer nada.
    .replace(/\r\n/g, "\n")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

const PACIENTES = sinComentarios("src/components/patients-explorer.tsx")
const BURBUJA = sinComentarios("src/components/athos/athos-widget.tsx")
const HISTORIAL = sinComentarios("src/components/athos/athos-sidebar-section.tsx")
const GLIFO = sinComentarios("src/components/brand-glyph.tsx")

describe("la tabla de pacientes", () => {
  it("«Historia» es la PRIMERA columna", () => {
    // Es la acción de la fila —lo que el vet viene a abrir— y estando última era además la que se
    // recortaba en pantallas angostas.
    const iHistoria = PACIENTES.indexOf(">\n                Historia")
    const iPaciente = PACIENTES.indexOf(">\n                Paciente")
    expect(iHistoria, "no se encontró la cabecera «Historia»").toBeGreaterThan(-1)
    expect(iPaciente).toBeGreaterThan(-1)
    expect(iHistoria, "«Historia» tiene que ir antes que «Paciente»").toBeLessThan(iPaciente)
  })

  it("NO RECORTA: la tabla se desplaza", () => {
    // Con `overflow-hidden` la última columna no se desplazaba, se PERDÍA — y sin ninguna señal de
    // que faltaba algo. Es lo que David reportó con una captura.
    expect(PACIENTES).toContain("overflow-x-auto rounded-lg border border-line-soft")
    expect(PACIENTES).not.toContain("overflow-hidden rounded-lg border border-line-soft")
  })

  it("el botón sigue llevando a la historia del paciente", () => {
    // Moverlo de sitio no puede cambiar a dónde va.
    const i = PACIENTES.indexOf("FileTextIcon className")
    expect(i).toBeGreaterThan(-1)
    expect(PACIENTES.slice(Math.max(0, i - 400), i + 100)).toContain("/dashboard/patients/")
  })
})

describe("la burbuja de Athos", () => {
  it("lleva el glifo de la marca, no un robot genérico", () => {
    expect(BURBUJA).toContain("BrandGlyph")
    expect(BURBUJA).not.toContain("<Bot ")
  })

  it("con `currentColor`, porque el fondo es `bg-primary`", () => {
    // El glifo pinta con `var(--accent)` por defecto, y sobre el menta del botón no contrastaría.
    const i = BURBUJA.indexOf("<BrandGlyph")
    expect(i, "no se encontró el uso del glifo").toBeGreaterThan(-1)
    expect(BURBUJA.slice(i, i + 120)).toContain('fill="currentColor"')
  })

  it("y el mismo glifo en la cabecera del panel", () => {
    // Abrir la burbuja no puede convertir el logo de la marca en otra cosa.
    expect(BURBUJA.split("<BrandGlyph").length - 1).toBeGreaterThanOrEqual(2)
  })
})

describe("el glifo compartido", () => {
  it("su color por defecto es el acento — la barra tiene que quedar igual que antes", () => {
    // Este cambio salió de extraer el glifo de `app-sidebar.tsx`. El defecto es lo que hace que la
    // cabecera de la barra no cambie de color al hacerlo.
    expect(GLIFO).toContain('fill = "var(--accent)"')
  })
})

describe("el historial", () => {
  it("la pestaña se llama «Cuaderno»", () => {
    // Pedido de David el 25-ago. Encaja: la columna donde vive lo que se escribe en la consulta se
    // llama `notebook` en la base desde siempre.
    expect(HISTORIAL).toContain('"Cuaderno"')
  })

  it("pero la CLAVE interna sigue siendo `consultas`", () => {
    // Es el estado del componente y la tabla que consulta. Renombrarla no le cambiaría nada a nadie
    // y sí rompería el resto del archivo.
    expect(HISTORIAL).toContain('"consultas" | "chats"')
  })
})

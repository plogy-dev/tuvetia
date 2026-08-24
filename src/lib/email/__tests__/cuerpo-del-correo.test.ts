/**
 * El cuerpo del correo se pinta AISLADO, y eso no puede cambiar sin que alguien se entere.
 *
 * ── QUÉ SE ESTÁ PROTEGIENDO ───────────────────────────────────────────────────────────────────
 *
 * El HTML de un correo lo escribe cualquiera que sepa la dirección de la clínica: es el contenido
 * menos confiable que toca esta aplicación. Se pinta dentro de un `<iframe sandbox="">`, sin
 * `allow-scripts` y sin `allow-same-origin`, porque las dos formas en que un correo arruina el día
 * son ejecutar código con la sesión del veterinario y romper la pantalla con su propio CSS.
 *
 * ── POR QUÉ ESTE TEST MIRA EL FUENTE ──────────────────────────────────────────────────────────
 *
 * Lo que hay que fijar es la AUSENCIA de tres cadenas —`allow-scripts`, `allow-same-origin`,
 * `dangerouslySetInnerHTML`— y una presencia, `sandbox=""`. Nada de eso se observa ejecutando el
 * componente: son atributos de un elemento que en un test de nodo no llega a existir. Y son
 * exactamente las tres cosas que alguien agrega de buena fe para "que el correo se vea mejor" sin
 * saber qué sostenían.
 *
 * El barrido previo (`sinLoEjecutable`) sí se ejercita de verdad. Ojo con leerlo como la defensa:
 * NO lo es. El sandbox ya impide ejecutar. Esto es una segunda pared, y los casos de abajo dicen
 * qué tapa y qué no.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

import { sinLoEjecutable } from "@/components/email/cuerpo-del-correo"

/**
 * El fuente SIN comentarios.
 *
 * El archivo explica en prosa por qué NO usa `allow-scripts` ni `dangerouslySetInnerHTML`, así que
 * un escaneo del texto crudo se marca a sí mismo: la explicación de por qué algo no está contiene
 * el nombre de ese algo. Es el mismo falso positivo que tuvo el cerrojo de los embeds.
 */
const FUENTE = readFileSync("src/components/email/cuerpo-del-correo.tsx", "utf8")
  .split("\n")
  .filter((l) => {
    const t = l.trim()
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*")
  })
  .join("\n")

describe("el aislamiento del correo", () => {
  it('el iframe va con `sandbox=""`, sin capacidades', () => {
    expect(FUENTE).toContain('sandbox=""')
  })

  it("NUNCA con allow-scripts ni allow-same-origin", () => {
    // Cualquiera de los dos le devuelve al correo justo lo que este componente existe para quitarle:
    // con `allow-scripts` ejecuta, y con los dos juntos sale del sandbox por completo.
    expect(FUENTE).not.toContain("allow-scripts")
    expect(FUENTE).not.toContain("allow-same-origin")
  })

  it("el HTML del correo NUNCA se inyecta en el documento de la app", () => {
    // `dangerouslySetInnerHTML` acá significaría ejecutar el correo con la sesión del vet.
    expect(FUENTE).not.toContain("dangerouslySetInnerHTML")
  })
})

describe("sinLoEjecutable — la segunda pared", () => {
  it("se lleva los <script> con su contenido", () => {
    expect(sinLoEjecutable('<p>hola</p><script>robar()</script>')).toBe("<p>hola</p>")
  })

  it("se lleva los manejadores de eventos, con comillas dobles y simples", () => {
    expect(sinLoEjecutable('<img src="x" onerror="robar()">')).toBe('<img src="x">')
    expect(sinLoEjecutable("<div onclick='robar()'>hola</div>")).toBe("<div>hola</div>")
  })

  it("desarma los enlaces `javascript:`", () => {
    expect(sinLoEjecutable('<a href="javascript:robar()">clic</a>')).not.toContain("javascript:")
  })

  it("no toca el contenido legítimo: imágenes, tablas y estilos siguen enteros", () => {
    const correo = '<table><tr><td><img src="https://cdn.ejemplo.com/logo.png" alt="Logo"></td></tr></table>'
    expect(sinLoEjecutable(correo)).toBe(correo)
  })

  // HONESTIDAD SOBRE EL ALCANCE. Un barrido con expresiones regulares no es un analizador de HTML y
  // se le escapan cosas —atributos sin comillas, entidades, `data:` con script—. Está anotado acá a
  // propósito: si alguien lo lee como "el HTML queda limpio" y decide que ya puede sacar el
  // sandbox, este test le dice que no.
  it("NO pretende dejar el HTML seguro — el sandbox es lo que protege", () => {
    // Un atributo sin comillas se le escapa, y está bien: no es la pared que sostiene esto.
    expect(sinLoEjecutable("<img src=x onerror=robar()>")).toContain("onerror")
  })
})

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * El tour de onboarding ancla sus pasos con SELECTORES CSS sobre el sidebar
 * (`element: 'a[href="/dashboard/consultas"]'`). Si un ítem se renombra, se mueve a un componente
 * que no emite `<a href>`, o sale del sidebar, driver.js no encuentra el elemento y **se salta el
 * paso sin avisar**: no falla el build, no falla ningún test, y nadie se entera hasta que un vet
 * nuevo hace el recorrido.
 *
 * Ya estuvo a punto de pasar: al reordenar el sidebar contra el demo del cliente, una de las
 * opciones sobre la mesa era sacar "Modo Fantasma" del menú — que es justo el ancla del paso 3.
 *
 * El test se hace sobre el TEXTO de los dos archivos a propósito. La alternativa era exportar la
 * lista de pasos y la de ítems para importarlas acá, pero eso obliga a refactorizar dos componentes
 * cliente para poder testearlos, y lo que se quiere verificar es literalmente que dos cadenas
 * coincidan entre dos archivos. Si un día se exportan por otro motivo, este test se reemplaza.
 */
const raiz = join(__dirname, "..")
const tour = readFileSync(join(raiz, "onboarding-tour.tsx"), "utf8")
const sidebar = readFileSync(join(raiz, "app-sidebar.tsx"), "utf8")

/** Los href que el tour espera encontrar en el DOM. */
function anclasDelTour(): string[] {
  return [...tour.matchAll(/element:\s*'a\[href="([^"]+)"\]'/g)].map((m) => m[1])
}

/** Los href que el sidebar declara en su lista de navegación. */
function urlsDelSidebar(): string[] {
  return [...sidebar.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1])
}

describe("anclas del tour de onboarding", () => {
  it("el tour ancla en al menos un ítem (si no, el regex dejó de servir)", () => {
    // Sin esta guarda, cambiar el formato de los pasos volvería el test verde y vacío — que es
    // exactamente el fallo silencioso que viene a evitar.
    expect(anclasDelTour().length).toBeGreaterThanOrEqual(4)
    expect(urlsDelSidebar().length).toBeGreaterThanOrEqual(9)
  })

  it("cada ancla del tour existe como ítem del sidebar", () => {
    const urls = new Set(urlsDelSidebar())
    const huerfanas = anclasDelTour().filter((href) => !urls.has(href))
    expect(huerfanas).toEqual([])
  })

  it("quien pinta esos ítems sigue emitiendo un <a href> de verdad", () => {
    // El selector de driver.js exige un ancla con href EN EL DOM. Un <button onClick> navega igual
    // pero el tour deja de encontrarlo.
    //
    // SIRVEN LAS DOS FORMAS, y la distinción importa: este test decía `<a href={item.url}>` y sólo
    // eso, con el argumento de que un `<Link>` «renderice otra cosa». No es así — `next/link`
    // renderiza un `<a href>` real, y de hecho es la única forma correcta acá: el ancla cruda
    // recargaba el documento y mataba la grabación en curso (ver `nav-main.tsx`). O sea que el test
    // pedía justamente lo que había que quitar.
    //
    // Lo que se verifica es lo que el tour necesita —que el href salga al DOM como ancla—, no con
    // qué componente. Un <button> no pasa.
    //
    // Y NO SE EXIGE QUE NO HAYA MÁS PROPS. El patrón era literal hasta el `/>` y se puso en rojo al
    // sumarle `prefetch` al link — un cambio que no toca en nada lo que este test protege. Un test
    // que falla por props que no le incumben enseña a editarlo sin leerlo, y el día que alguien
    // cambie el `<Link>` por un `<button>` ya nadie lo va a estar mirando.
    const navMain = readFileSync(join(raiz, "nav-main.tsx"), "utf8")
    expect(navMain).toMatch(/render=\{<(?:Link|a) href=\{item\.url\}[^>]*\/>\}/)
  })
})

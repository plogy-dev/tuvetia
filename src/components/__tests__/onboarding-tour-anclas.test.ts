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
    // El selector de driver.js exige un ancla con href. Un <button onClick> o un <Link> que
    // renderice otra cosa navegan igual pero el tour deja de encontrarlos.
    const navMain = readFileSync(join(raiz, "nav-main.tsx"), "utf8")
    expect(navMain).toMatch(/render=\{<a href=\{item\.url\} \/>\}/)
  })
})

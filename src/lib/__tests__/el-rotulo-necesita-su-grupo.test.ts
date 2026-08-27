/**
 * Un `DropdownMenuLabel` fuera de un `DropdownMenuGroup` TIRA LA PANTALLA.
 *
 * ── EL FALLO, 27-ago ────────────────────────────────────────────────────────────────────────────
 *
 * En Ventas, tocar «Secciones» mandaba la pantalla entera al error boundary («Esta pantalla falló»)
 * y dejaba el menú de ventas inalcanzable — nueve pantallas detrás de un botón que reventaba.
 *
 * La causa no era el submenú, que era el sospechoso obvio. Reproducido montando el componente con
 * un DOM de verdad:
 *
 *     Base UI: MenuGroupContext is missing.
 *     Menu group parts must be used within <Menu.Group> or <Menu.RadioGroup>.
 *
 * `DropdownMenuLabel` es `Menu.GroupLabel`, y esa primitiva LANZA si no encuentra su grupo. En
 * `MenuDeVentas` el rótulo «Documentos» colgaba directo del contenido del menú. `nav-user.tsx` sí
 * lo envolvía — era el único correcto de los dos usos que hay en la app.
 *
 * ── POR QUÉ UN CERROJO DE TEXTO Y NO UNO DE RENDER ──────────────────────────────────────────────
 *
 * Este error sólo ocurre AL ABRIR el menú: el componente monta sin problema y revienta cuando el
 * usuario hace clic. Ningún test del repo lo veía, y el build tampoco — el contrato es de RUNTIME,
 * no de tipos, así que TypeScript acepta el anidamiento mal.
 *
 * Montar cada menú con un DOM sería el test ideal, pero el repo corre en `environment: node` y no
 * tiene jsdom instalado. Esta comprobación estática cuesta milisegundos y ataja exactamente el
 * error que se cometió: un rótulo sin su grupo.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

/** Los `.tsx` de la app. `components/ui` queda fuera: ahí viven las primitivas, no sus usos. */
const fuentes = () =>
  readdirSync(RAIZ, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => !f.startsWith("components/ui/"))

describe("todo rótulo de menú vive dentro de su grupo", () => {
  it("ningún DropdownMenuLabel cuelga suelto del contenido", () => {
    const culpables: string[] = []

    for (const ruta of fuentes()) {
      const texto = readFileSync(join(RAIZ, ruta), "utf8")
      if (!texto.includes("<DropdownMenuLabel")) continue

      // Se compara la posición del rótulo contra la del grupo que lo envuelve. Basta con que el
      // archivo abra un grupo ANTES del primer rótulo y lo cierre DESPUÉS: no hace falta un parser
      // para atrapar el caso real, que es no haber puesto grupo en absoluto.
      const iRotulo = texto.indexOf("<DropdownMenuLabel")
      const iGrupo = texto.indexOf("<DropdownMenuGroup")
      const iCierre = texto.indexOf("</DropdownMenuGroup>")
      const dentro = iGrupo !== -1 && iGrupo < iRotulo && iCierre > iRotulo
      if (!dentro) culpables.push(ruta)
    }

    expect(
      culpables,
      "Menu.GroupLabel de Base UI lanza sin su Menu.Group: la pantalla se cae al abrir el menú",
    ).toEqual([])
  })
})

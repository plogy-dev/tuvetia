/**
 * El historial de Athos: abajo, y SIEMPRE desplegado.
 *
 * LA HISTORIA IMPORTA porque este archivo cambió de bando. El 19-ago David pidió el historial
 * «abajo y plegable», y este test fijaba el plegable. El 28-ago el mismo David se encontró el
 * panel escondido —«se me perdieron las consultas… eso debería aparecer siempre»— y el 31-ago
 * pidió lo contrario: siempre desplegado, sin plegable. Quien pliega una vez y lo olvida
 * reencuentra un panel «vacío» semanas después, y eso se lee como datos perdidos.
 *
 * Lo que sostiene la reversa sin resucitar el problema del 19-ago (cuarenta consultas empujando
 * el resto de la barra fuera de la vista) es el TECHO CON SCROLL PROPIO de la lista — por eso
 * ese anclaje se queda, y ahora es el más importante del archivo.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

function leer(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const BARRA = leer("components/app-sidebar.tsx")
const SECCION = leer("components/athos/athos-sidebar-section.tsx")

describe("abajo", () => {
  // ── ESTE BLOQUE CAMBIÓ DE MECANISMO EL 25-AGO, NO DE INTENCIÓN ────────────────────────────────
  //
  // Vigilaba que el historial fuera DESPUÉS de Integraciones/Configuración/Ayuda. Ése era el
  // arreglo del 19-ago para un problema real: el historial crece con las consultas y, estando
  // arriba, empujaba esas tres fuera de la barra.
  //
  // David pidió el 25-ago lo contrario —«integraciones y configuración deben ir abajo al final»— y
  // el orden se invirtió. Pero EL PROBLEMA DEL 19-AGO NO DESAPARECIÓ: si esas tres quedaran al
  // final del CONTENIDO, un historial largo volvería a empujarlas fuera.
  //
  // Se resolvió anclándolas en el PIE, que no scrollea con el contenido. Así que lo que se vigila
  // ahora es eso —el ancla— y no el orden, que era sólo cómo se conseguía antes.

  it("el historial no está arriba del menú", () => {
    const iMenu = BARRA.indexOf("<NavMain")
    const iHistorial = BARRA.indexOf("<AthosSidebarSection")
    expect(iMenu).toBeGreaterThan(-1)
    expect(iHistorial).toBeGreaterThan(iMenu)
  })

  it("INTEGRACIONES/CONFIGURACIÓN/AYUDA VIVEN EN EL CONTENIDO, y por eso scrollean", () => {
    // 26-AGO: ESTA PRUEBA VIGILABA LO CONTRARIO. Decía «viven en el pie», porque el 19-ago un
    // historial de cuarenta consultas las empujaba fuera de la pantalla y no quedaba rastro de
    // que siguieran ahí. David pidió invertirlo mirando la barra: que el escudo, el enchufe y el
    // signo de pregunta «también bajen, que no se queden sticky».
    //
    // Se pudo conceder porque la razón vieja dejó de aplicar, no porque se ignorara: el
    // contenedor ahora DELATA lo que esconde (el degradado de `SidebarContent`, vigilado en
    // `el-ancho-no-corta.test.ts`). Ese degradado es la condición de esta decisión — si alguien
    // lo quita, hay que devolver estas tres al pie, no dejarlas perdidas al fondo.
    const iFinContenido = BARRA.indexOf("</SidebarContent>")
    const iSecundario = BARRA.indexOf("<NavSecondary")
    expect(iSecundario).toBeGreaterThan(-1)
    expect(iSecundario).toBeLessThan(iFinContenido)
  })

  it("pero ARRIBA del Historial, o vuelve el defecto del 19-ago con otro disfraz", () => {
    // Debajo cumplirían igual la letra del pedido —scrollean, no son sticky— y quedarían
    // enterradas bajo cuarenta consultas, que es palabra por palabra el problema que el orden
    // invertido vino a arreglar. Acá arriba se sostienen las dos cosas: estas cuatro quedan a un
    // scroll corto aunque el Historial —que ahora se monta en toda la app— venga cargado.
    const iSecundario = BARRA.indexOf("<NavSecondary")
    const iHistorial = BARRA.indexOf("<AthosSidebarSection")
    expect(iSecundario).toBeLessThan(iHistorial)
  })

  it("y el pie se queda sólo con la cuenta, que es lo que no se puede perder de vista", () => {
    // Cerrar sesión y cambiar de clínica siguen ancladas a propósito: son la salida.
    const iPie = BARRA.indexOf("<SidebarFooter>")
    const iFinDelPie = BARRA.indexOf("</SidebarFooter>")
    const iUsuario = BARRA.indexOf("<NavUser")
    expect(iPie).toBeGreaterThan(-1)
    expect(iUsuario).toBeGreaterThan(iPie)
    expect(iUsuario).toBeLessThan(iFinDelPie)
  })

  it("y el historial sigue en el contenido, que es lo que scrollea", () => {
    // Si se metiera al pie «para que se vea siempre», con muchas consultas taparía la barra entera.
    const iFinContenido = BARRA.indexOf("</SidebarContent>")
    const iHistorial = BARRA.indexOf("<AthosSidebarSection")
    expect(iHistorial).toBeLessThan(iFinContenido)
  })
})

describe("siempre desplegado", () => {
  it("se monta en TODO el dashboard, no en dos pantallas", () => {
    // La puerta de entrada es el tablero y la PWA abre en el calendario: un historial que sólo
    // existe en /asistente y /consultas se lee como «se me borraron las consultas» (28-ago).
    expect(SECCION).toMatch(/const visible = pathname\.startsWith\("\/dashboard"\)/)
  })

  it("no queda NI RASTRO del plegable", () => {
    // La reversa del 31-ago. Si «plegado» reaparece en este archivo, alguien está reconstruyendo
    // el acordeón — y con él, el malentendido de los paneles «vacíos».
    expect(SECCION.toLowerCase()).not.toContain("plegado")
    expect(SECCION).not.toContain("aria-expanded")
  })

  it("la lista tiene techo y scroll propio — es lo que hace viable el siempre-abierto", () => {
    // Sin esto, cuarenta filas empujan lo de abajo hasta sacarlo de la pantalla: el problema
    // del 19-ago, que el plegable resolvía y que ahora resuelve SOLO este techo.
    expect(SECCION).toMatch(/max-h-\[\d+svh\][^"]*overflow-y-auto/)
  })

  it("un fallo de carga se dice, no se disfraza de vacío", () => {
    // Con la sesión caída, «Todavía no hay consultas» es indistinguible de perder todo.
    expect(SECCION).toContain("No se pudo cargar el historial")
  })
})

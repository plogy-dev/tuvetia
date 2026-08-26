/**
 * El historial de Athos: abajo y plegable.
 *
 * LO QUE PIDIÓ DAVID, el 19-ago: *"las consultas y los chats, abajo y plegables"*. Las dos mitades
 * resuelven la misma molestia — el historial vive en la barra lateral y, con cuarenta consultas
 * cargadas, empujaba Configuración y Ayuda fuera de la vista justo en la pantalla donde uno está
 * trabajando.
 *
 * DOS DE LOS TRES ARREGLOS NO SE VEN AL PROBAR, y por eso están acá:
 *
 *   · Plegado, el panel no pide NADA a la base. Son tres consultas —consultas, mensajes y
 *     pacientes— para pintar algo que está cerrado. Que se sigan haciendo no rompe nada visible:
 *     sólo cuesta.
 *   · La lista tiene techo y scroll propio. Sin eso, plegar arregla el caso cerrado y deja el
 *     abierto igual de roto.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  CLAVE_HISTORIAL_PLEGADO,
  estaPlegado,
  valorAGuardar,
} from "@/lib/athos/historial-plegado"

describe("acordarse de si estaba plegado", () => {
  it("guardado como plegado, arranca plegado", () => {
    expect(estaPlegado(valorAGuardar(true))).toBe(true)
  })

  it("guardado como abierto, arranca abierto", () => {
    expect(estaPlegado(valorAGuardar(false))).toBe(false)
  })

  it("sin nada guardado, ABIERTO", () => {
    // Es la falla barata: un panel abierto que no se quería se cierra con un clic; uno plegado que
    // sí se quería es una función que desapareció sin explicación.
    expect(estaPlegado(null)).toBe(false)
    expect(estaPlegado(undefined)).toBe(false)
    expect(estaPlegado("")).toBe(false)
  })

  it("con basura, ABIERTO", () => {
    // `localStorage` devuelve `string | null` y ahí adentro puede haber una versión vieja del
    // valor, algo de otra pestaña, o basura de una extensión. Leer eso sin cuidado es cómo un panel
    // termina plegado para siempre sin que el usuario pueda arreglarlo salvo limpiando el
    // navegador.
    for (const basura of ["true", "sí", "{}", "0", "01", " 1", "PLEGADO"]) {
      expect(estaPlegado(basura), basura).toBe(false)
    }
  })

  it("la clave lleva prefijo del producto", () => {
    // `localStorage` es un espacio compartido con todo lo que corra en el dominio. Una clave
    // llamada "plegado" a secas es una colisión esperando.
    expect(CLAVE_HISTORIAL_PLEGADO).toMatch(/^tuvetia:/)
  })
})

// ── Lo que no se ve al probar la pantalla ───────────────────────────────────────────────────────

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

  it("INTEGRACIONES/CONFIGURACIÓN/AYUDA VIVEN EN EL PIE, no en el contenido", () => {
    // Es lo que impide que un historial de cuarenta consultas las saque de la pantalla. En el
    // contenido, «al final» dura hasta que alguien tenga muchas consultas.
    const iPie = BARRA.indexOf("<SidebarFooter>")
    const iFinDelPie = BARRA.indexOf("</SidebarFooter>")
    const iSecundario = BARRA.indexOf("<NavSecondary")
    expect(iPie).toBeGreaterThan(-1)
    expect(iSecundario).toBeGreaterThan(iPie)
    expect(iSecundario).toBeLessThan(iFinDelPie)
  })

  it("y el historial sigue en el contenido, que es lo que scrollea", () => {
    // Si se metiera al pie «para que se vea siempre», con muchas consultas taparía la barra entera.
    const iFinContenido = BARRA.indexOf("</SidebarContent>")
    const iHistorial = BARRA.indexOf("<AthosSidebarSection")
    expect(iHistorial).toBeLessThan(iFinContenido)
  })
})

describe("plegable", () => {
  it("la cabecera es un botón que dice si está abierto", () => {
    // Sin `aria-expanded`, un lector de pantalla anuncia "Historial, botón" y no dice si al tocarlo
    // va a abrir o a cerrar — que es la única pregunta que importa en un plegable.
    expect(SECCION).toMatch(/aria-expanded=\{!plegado\}/)
    expect(SECCION).toMatch(/aria-controls="athos-historial"/)
    expect(SECCION).toContain('id="athos-historial"')
  })

  it("plegado NO pide nada a la base", () => {
    // Son tres consultas para pintar algo que está cerrado. Que se sigan haciendo no rompe nada
    // visible: sólo cuesta, y por eso nadie lo notaría. (El `consultas !== null` que acompañaba a
    // esta guarda se quitó a propósito el 26-ago: cacheaba la lista para siempre y el chat recién
    // dejado no aparecía en el historial hasta recargar — ahora se refresca al navegar.)
    expect(SECCION).toMatch(/if \(!visible \|\| plegado\) return/)
    // Y `plegado` tiene que estar en las DEPENDENCIAS, o el efecto no vuelve a correr al desplegar
    // y el panel abriría vacío para siempre. La guarda sin la dependencia es media solución, y se
    // ve peor que ninguna.
    expect(SECCION).toMatch(/\}, \[visible, plegado, rutaKey\]\)/)
  })

  it("la lista tiene techo y scroll propio", () => {
    // Sin esto, plegar arregla el caso cerrado y deja el abierto igual de roto: cuarenta filas
    // siguen empujando lo de abajo hasta sacarlo de la pantalla.
    expect(SECCION).toMatch(/max-h-\[\d+svh\][^"]*overflow-y-auto/)
  })

  it("se lee con `useSyncExternalStore`, con su rama de servidor", () => {
    // El servidor no tiene `window`: leer `localStorage` en el render produce un HTML distinto del
    // que hidrata, y un error de hidratación tira la interactividad de TODO el árbol.
    //
    // La primera versión de esto usaba `useState` + `useEffect`, que evita el mismo problema pero
    // llama a `setState` DENTRO del efecto — un render en cascada, y lo que el linter de React
    // marca. `useSyncExternalStore` es la API que React documenta exactamente para esto.
    expect(SECCION).toMatch(/useSyncExternalStore\(\s*suscribirAlPlegado,\s*leerPlegado,\s*plegadoEnElServidor\s*\)/)
  })

  it("el almacenamiento bloqueado no tira la pantalla", () => {
    // Incógnito con almacenamiento deshabilitado hace que `localStorage` LANCE, no que devuelva
    // null. Sin el try, la barra entera se cae en esa ventana.
    const ALMACEN = leer("lib/athos/historial-plegado.ts")
    expect(ALMACEN).toMatch(/try \{[\s\S]{0,220}localStorage\.getItem/)
    expect(ALMACEN).toMatch(/try \{[\s\S]{0,220}localStorage\.setItem/)
    // Y el valor del servidor tiene que ser el abierto, no el plegado.
    expect(ALMACEN).toMatch(/plegadoEnElServidor\(\)[\s\S]{0,80}return false/)
  })

  it("otra pestaña que pliega, pliega en todas", () => {
    // Sale gratis con `useSyncExternalStore`: el evento `storage` avisa cuando OTRA pestaña cambia
    // el valor. Y hace falta un evento propio además, porque `storage` NO lo escucha la pestaña que
    // escribe — sin él, plegar no repintaría nada en la ventana donde se tocó el botón.
    const ALMACEN = leer("lib/athos/historial-plegado.ts")
    expect(ALMACEN).toContain('addEventListener("storage"')
    expect(ALMACEN).toContain("dispatchEvent(new Event(EVENTO))")
    expect(ALMACEN).toContain("removeEventListener")
  })
})

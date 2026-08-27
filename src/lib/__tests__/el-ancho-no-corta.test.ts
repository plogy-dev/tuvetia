/**
 * El shell del dashboard no puede volver a cortar contenido ni a esconder la navegación.
 *
 * ── LO QUE PASÓ (25-ago, capturas de David) ───────────────────────────────────────────────────
 *
 * «El ancho corta letras, encabezados y calendarios» y «se pierde el Athos y el modo fantasma».
 * Ninguno era un bug de una pantalla: eran CUATRO propiedades del shell, cada una inocente por sí
 * sola, que juntas cortaban en todas partes:
 *
 *   · el layout pisaba `--sidebar-width` con 288 px sobre los 232 medidos del prototipo;
 *   · `SidebarInset` sin `min-w-0` — su ancho mínimo era el del contenido, y una tabla ancha
 *     empujaba la página entera a scroll horizontal POR DEBAJO de la barra fija;
 *   · el buscador de la cabecera exigía 260 px fijos, hubiera o no;
 *   · el pie apilado costaba ~232 px y el grupo «Consulta» caía bajo el pliegue en 1366×768.
 *
 * Ninguna clase de Tailwind se puede testear "midiendo" sin navegador — pero la PRESENCIA de cada
 * propiedad sí, y así se rompe en el PR y no en la captura del cliente. Es el mismo trato que
 * `foco-de-teclado.test.ts` le da al focus.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const leer = (...ruta: string[]) =>
  readFileSync(join(...ruta), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

describe("el ancho del shell", () => {
  it("el layout no pisa el ancho medido de la barra", () => {
    // `ui/sidebar.tsx` declara 232 px medidos del prototipo; el spread `...style` del provider va
    // último, así que cualquier `--sidebar-width` inline del layout GANA y los 56 px de diferencia
    // salen del área de trabajo en todas las pantallas.
    const layout = leer("src", "app", "dashboard", "layout.tsx")
    expect(layout).not.toContain("--sidebar-width")
  })

  it("SidebarInset lleva min-w-0", () => {
    // Es hijo flex en eje horizontal: sin `min-w-0` su ancho mínimo es el del contenido, y el
    // contenido ancho desborda la PÁGINA en vez de scrollear en su propio marco.
    const sidebar = leer("src", "components", "ui", "sidebar.tsx")
    const inset = sidebar.slice(sidebar.indexOf("function SidebarInset"))
    expect(inset.slice(0, 600)).toContain("min-w-0")
  })

  it("el buscador de la cabecera cede ancho y el título trunca", () => {
    const header = leer("src", "components", "site-header.tsx")
    // max-w, no w fijo: entre 768 y ~900 px de ventana los 260 fijos no cabían y el sobrante
    // desbordaba la cabecera entera. `(?<!-)`: sin el lookbehind, `\bw-` coincide DENTRO de
    // `max-w-` —el guión es frontera de palabra— y el cerrojo se prohibía a sí mismo el arreglo
    // que protege.
    expect(header).not.toMatch(/(?<!-)w-\[260px\]/)
    expect(header).toMatch(/max-w-\[260px\]/)
    expect(header).toMatch(/min-w-0 truncate[^"]*"[^>]*>\{title\}/)
  })

  it("el calendario scrollea en su marco en vez de comprimir los días", () => {
    const cal = leer("src", "components", "calendar", "appointment-calendar.tsx")
    const i = cal.indexOf("tuvetia-calendar")
    expect(i).toBeGreaterThan(-1)
    expect(cal.slice(i, i + 200)).toContain("overflow-x-auto")
    expect(cal.slice(i, i + 300)).toMatch(/min-w-\[\d+px\]/)
  })
})

describe("la fila de accesos (integraciones · administración · configuración · ayuda)", () => {
  it("es una fila de iconos, no una pila — o «Consulta» vuelve a caer bajo el pliegue", () => {
    // Ya no vive en el pie (26-ago: David pidió que bajara con el resto), pero la fila sigue
    // siendo lo correcto: apilada costaba ~232 px de alto contra ~90 en fila, y ahora ese alto
    // se lo cobra al scroll de todos los demás.
    const nav = leer("src", "components", "nav-secondary.tsx")
    expect(nav).toContain("flex-row")
    // Y colapsada en modo icono vuelve a columna: ahí la barra mide 3rem y la fila no cabe.
    expect(nav).toContain("group-data-[collapsible=icon]:flex-col")
  })

  it("cada icono conserva su nombre para el lector de pantalla", () => {
    // Quitar el rótulo visible es legítimo; quitárselo al lector no.
    const nav = leer("src", "components", "nav-secondary.tsx")
    expect(nav).toContain("aria-label={item.title}")
    expect(nav).toContain("sr-only")
  })

  it("no hay dos ítems del pie encendidos a la vez", () => {
    // Administración contiene a Configuración: sin el desempate del más específico, en
    // /administracion/clinica se encendían los dos.
    const nav = leer("src", "components", "nav-secondary.tsx")
    expect(nav).toContain("urlActivaEntre")
  })
})

describe("la barra en modo icono", () => {
  it("scrollea en vez de recortar", () => {
    // El dashboard ARRANCA colapsado: con `overflow-hidden` en ese modo, lo que no cupiera quedaba
    // inalcanzable y sin ninguna barra que delatara que había más.
    const sidebar = leer("src", "components", "ui", "sidebar.tsx")
    expect(sidebar).not.toContain("group-data-[collapsible=icon]:overflow-hidden")
    // Y la clase fantasma no vuelve: `no-scrollbar` no existe en ningún CSS del repo.
    expect(sidebar).not.toContain("no-scrollbar")
  })
})

describe("la barra avisa cuando esconde contenido", () => {
  // ── LA TERCERA VUELTA SOBRE EL MISMO PROBLEMA ────────────────────────────────────────────────
  //
  // 1) La barra del sistema escondía contenido y se veía mal → se quitó (David: «no pueden
  //    aparecer barras grises»). 2) Se recortaron 44 px de alto. Resultado neto: se seguía
  //    escondiendo contenido y ya no quedaba NINGUNA pista de que existía.
  //
  // Medido en producción el 26-ago con ventana de 639 px: en Modo Fantasma el contenido de la
  // barra mide 928 px en 464 de espacio — la mitad invisible, incluido el Historial entero.
  //
  // Lo que se protege acá es la señal, no los píxeles: recortar alto no cierra esto porque cada
  // monitor mide distinto.
  const sidebar = leer("src", "components", "ui", "sidebar.tsx")

  it("mide el desborde de verdad, no lo adivina con una media query", () => {
    // El alto disponible NO es el de la ventana: la barra tiene cabecera y pie anclados (el pie,
    // desde el 26-ago, sólo la cuenta). Una media query acertaría en un monitor y fallaría en el
    // resto.
    expect(sidebar).toContain("scrollHeight")
    expect(sidebar).toContain("clientHeight")
  })

  it("se entera cuando el contenido cambia de alto, no sólo el contenedor", () => {
    // El Historial se monta sólo en VetGPT y Modo Fantasma, y se pliega: el contenido crece y
    // encoge sin que el contenedor cambie de tamaño. Con sólo ResizeObserver la señal se queda
    // pegada en el estado anterior.
    expect(sidebar).toContain("ResizeObserver")
    expect(sidebar).toContain("MutationObserver")
  })

  it("la señal es una máscara, no una barra del sistema", () => {
    // `mask-image` no ocupa lugar, no intercepta clics y no obliga a envolver el contenedor.
    // Y sobre todo: no es la barra gris que el cliente pidió sacar.
    expect(sidebar).toContain("maskImage")
    expect(sidebar).not.toContain("scrollbar-width: thin")
  })
})

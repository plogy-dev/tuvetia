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

// Administración salió de la fila el 31-ago (David pidió UNA puerta: la del rótulo tras Ventas).
describe("la fila de accesos (integraciones · configuración · ayuda)", () => {
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
    // El desempate del más específico se queda aunque Administración ya no esté en la fila:
    // Configuración (/administracion/clinica) sigue conviviendo con rutas que la contienen, y
    // quitar el helper es cómo el defecto vuelve con el próximo ítem que se agregue.
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
  // LA MEDICIÓN SE MUDÓ A UN GANCHO el 27-ago, y no por prolijidad: hizo falta la MISMA señal en el
  // riel de la agenda. Allá el mismo problema —una lista cortada sin aviso de que había más— se
  // había resuelto QUITÁNDOLE el scroll a la columna, y eso devolvió el desplazamiento a la página
  // entera. El gancho es lo que hace que la próxima vez la respuesta sea avisar y no quitar.
  const gancho = leer("src", "hooks", "use-hay-mas-abajo.ts")
  const sidebar = leer("src", "components", "ui", "sidebar.tsx")
  const riel = leer("src", "components", "calendar", "panel-de-agenda.tsx")

  it("mide el desborde de verdad, no lo adivina con una media query", () => {
    // El alto disponible NO es el de la ventana: la barra tiene cabecera y pie anclados (el pie,
    // desde el 26-ago, sólo la cuenta). Una media query acertaría en un monitor y fallaría en el
    // resto.
    expect(gancho).toContain("scrollHeight")
    expect(gancho).toContain("clientHeight")
  })

  it("se entera cuando el contenido cambia de alto, no sólo el contenedor", () => {
    // El Historial se monta sólo en VetGPT y Modo Fantasma, y se pliega: el contenido crece y
    // encoge sin que el contenedor cambie de tamaño. Con sólo ResizeObserver la señal se queda
    // pegada en el estado anterior. Y en el riel de la agenda pasa lo mismo cuando entra un
    // veterinario nuevo a la clínica.
    expect(gancho).toContain("ResizeObserver")
    expect(gancho).toContain("MutationObserver")
  })

  it("la señal es una máscara, no una barra del sistema", () => {
    // `mask-image` no ocupa lugar, no intercepta clics y no obliga a envolver el contenedor.
    // Y sobre todo: no es la barra gris que el cliente pidió sacar.
    expect(sidebar).toContain("maskImage")
    expect(sidebar).not.toContain("scrollbar-width: thin")
  })

  it("el riel de la agenda avisa igual que la barra, en vez de renunciar a su scroll", () => {
    // El 27-ago el riel perdió `overflow-y-auto` para que no cortara nombres. Sin el techo, la fila
    // de la agenda dejó de acotarse y volvió la barra de PÁGINA — que es el defecto que el cliente
    // ya había reportado dos veces. La respuesta correcta a «esconde contenido» es la señal, no
    // quitar el contenedor que lo acota.
    expect(riel).toContain("overflow-y-auto")
    expect(riel).toContain("maskImage")
  })
})

describe("la agenda no desborda la página", () => {
  // Reporte 26-ago: «la agenda está completamente desbordada y toca hacer scroll down».
  //
  // No era un descuido sino un empate imposible: «Hoy» era `shrink-0` —no cede nunca— y la grilla
  // tiene un piso de 420 px. Dos bloques que no ceden en una columna de alto acotado sólo pueden
  // desbordar. La cuenta a 768 px de alto: 640 disponibles contra 771 pedidos.
  //
  // Lo que se vigila es CUÁL de los dos cede, que es la decisión. Los píxeles pueden cambiar.

  it("«Hoy» puede encogerse — no vuelve a ser shrink-0", () => {
    const hoy = leer("src", "components", "calendar", "dia-de-hoy.tsx")
    expect(hoy).not.toContain("lg:shrink-0")
    // Y cede hasta un piso, no hasta desaparecer: la cabecera y una fila.
    expect(hoy).toMatch(/lg:min-h-\[\d+px\]/)
  })

  it("y su lista deja de medirse contra el viewport en pantalla grande", () => {
    // `30svh` no sabe que la grilla de abajo ya reclamó sus 420 px. Dentro de una columna acotada
    // el techo tiene que ser lo que le toque, no una fracción de la ventana.
    const hoy = leer("src", "components", "calendar", "dia-de-hoy.tsx")
    expect(hoy).toContain("lg:max-h-none")
    expect(hoy).toContain("lg:flex-1")
  })

  it("la grilla conserva su piso: es la parte que no puede achicarse", () => {
    // Si cediera ésta en vez de «Hoy», la semana quedaría sin alto para decir ni la hora.
    const cal = leer("src", "components", "calendar", "appointment-calendar.tsx")
    expect(cal).toMatch(/lg:min-h-\[\d+px\]/)
  })
})

describe("el chat de VetGPT no scrollea con la página", () => {
  // Reporte 27-ago con capturas: al bajar en el hilo, la CABECERA se iba de vista y había que
  // scrollear para reencontrar el compositor. En la pantalla donde más se escribe.
  //
  // Dos causas sumadas, y las dos son la misma deuda de shell que desbordó la agenda:
  //   · el riel de la clínica tenía `overflow-auto` SIN `min-h-0`, así que su contenido empujaba
  //     la fila y de ahí para arriba — scroll que nunca llegaba a activarse;
  //   · y la página confiaba en heredar un alto que nadie acota (`SidebarProvider` es `min-h-svh`).

  it("el riel puede encogerse: overflow-auto sin min-h-0 no scrollea, empuja", () => {
    // Hay DOS asides: el riel plegado (una fila de iconos, contenido corto que no empuja) y el
    // desplegado, que es el del scroll. Se busca por el `overflow-auto`, que es lo que lo define.
    const riel = leer("src", "components", "athos", "riel-clinica.tsx")
    const i = riel.indexOf("overflow-auto")
    expect(i, "el riel desplegado tiene que seguir teniendo su propio scroll").toBeGreaterThan(-1)
    const apertura = riel.lastIndexOf("<aside", i)
    const aside = riel.slice(apertura, riel.indexOf(">", i))
    expect(aside).toContain("min-h-0")
  })

})

describe("EL SHELL ACOTA — la raíz de todos los desbordes", () => {
  // ── LO QUE COSTÓ LLEGAR ACÁ ─────────────────────────────────────────────────────────────────
  //
  // Tres reportes del cliente en dos días, en tres pantallas distintas: la agenda desbordada, el
  // chat que se llevaba la cabecera al scrollear, y «aparece en todo». Se parchó dos veces en
  // local —con `h-[calc(...)]` por pantalla— antes de aceptar que la causa era UNA palabra.
  //
  // `SidebarProvider` era `min-h-svh`: altura MÍNIMA, o sea que el shell crecía con su contenido
  // en vez de acotarlo. Y eso hacía FALSA la doctrina que el chat, el cockpit y la agenda tienen
  // escrita — `flex-1 min-h-0` sólo reparte cuando alguien de arriba tiene alto DEFINIDO. Sin
  // escasez no hay reparto: los hijos podían ceder todo lo que quisieran y no cedía nadie.
  //
  // Son DOS mitades y por eso hay dos tests: acotar sin mover el scroll adentro recortaría
  // contenido, y mover el scroll sin acotar no cambiaría nada.

  it("el shell mide el viewport, no crece con su contenido", () => {
    const sidebar = leer("src", "components", "ui", "sidebar.tsx")
    const i = sidebar.indexOf("group/sidebar-wrapper")
    expect(i).toBeGreaterThan(-1)
    const clases = sidebar.slice(i, i + 120)
    expect(clases).toContain("h-svh")
    expect(clases, "`min-h-svh` es lo que dejaba crecer el shell").not.toContain("min-h-svh")
  })

  it("y el scroll vive en el contenido, para que la cabecera no se vaya de viaje", () => {
    // Cabecera, barra lateral y barra inferior del móvil quedan FUERA de este contenedor: por eso
    // se quedan quietas mientras el contenido se mueve.
    const layout = leer("src", "app", "dashboard", "layout.tsx")
    expect(layout).toMatch(/flex min-h-0 flex-1 flex-col overflow-y-auto/)
  })

  it("y las pantallas vuelven a heredar el alto en vez de calcularlo", () => {
    // Con la raíz arreglada, los parches por pantalla sobran — y dejarlos sería mantener dos
    // fuentes de verdad para el mismo alto. Si alguno reaparece, es señal de que la raíz se rompió
    // otra vez y alguien está tapándolo pantalla por pantalla, que es justo lo que pasó el 27-ago.
    for (const ruta of [
      ["src", "app", "dashboard", "asistente", "page.tsx"],
      ["src", "app", "dashboard", "calendario", "page.tsx"],
    ]) {
      expect(leer(...ruta), `${ruta.at(-2)} volvió a calcular su alto`).not.toContain(
        "100svh-var(--header-height)",
      )
    }
  })
})

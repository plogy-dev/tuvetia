/**
 * Cada entrada del menú «Secciones» se llama igual que el título de la pantalla a la que lleva.
 *
 * ── EL DEFECTO, encontrado en la auditoría de UX del 27-ago ────────────────────────────────────
 *
 * Cuatro de las diez entradas del menú llevaban a una pantalla con OTRO nombre:
 *
 *     el menú decía              la pantalla se titulaba
 *     ─────────────────────      ──────────────────────────────────────
 *     Productos y servicios      Catálogo
 *     Existencias                Inventario
 *     Salidas y reservas         Movimientos y salidas  (y «Movimientos» con el módulo apagado)
 *     Importar catálogo          Importar inventario
 *
 * Y el botón más usado del módulo, «Registrar venta», llevaba a una pantalla titulada «Nueva
 * cuenta» — a la que también se llegaba desde «Crear la primera factura» y «Facturar lo recetado».
 * Tres rótulos, un destino, y ninguno usaba la palabra que el destino usaba para sí mismo.
 *
 * En `/facturacion/inventario` llegaron a convivir CINCO palabras para ubicar una sola pantalla:
 * la barra lateral decía «Ventas», la cabecera «Ventas», la flecha de volver «Facturación», el
 * título «Inventario» y el menú «Existencias».
 *
 * ── POR QUÉ IMPORTA ACÁ MÁS QUE EN OTRO MÓDULO ─────────────────────────────────────────────────
 *
 * Porque la razón de ser de esta pantalla es que NO haya que reaprender nada: los veterinarios ya
 * saben usar OkVet, y el pedido del cliente fue copia exacta, no aproximación. Un usuario que hace
 * clic en «Productos y servicios» y aterriza en «Catálogo» no sabe si llegó a donde quería. Eso no
 * es un detalle de redacción: es la diferencia entre reconocer y tener que averiguar.
 *
 * Esto ya se desincronizó cuatro veces, así que la comprobación va acá y no en la cabeza de nadie.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = process.cwd()
const leer = (...p: string[]) => readFileSync(join(RAIZ, ...p), "utf8")

const MENU = leer("src", "components", "facturacion", "MenuDeVentas.tsx")

/** `href` de una ruta del panel → el `page.tsx` que la sirve. */
function archivoDeLaRuta(href: string): string {
  const rel = href.replace(/^\/dashboard\//, "")
  return join(RAIZ, "src", "app", "dashboard", ...rel.split("/"), "page.tsx")
}

/**
 * Los títulos que una pantalla se pone a sí misma: los `<h1>` y los `title=` de `PageHeader`.
 *
 * Son varios a propósito — casi todas tienen dos, una para el módulo activo y otra para el módulo
 * apagado, y las DOS tienen que decir lo mismo que el menú. La de «módulo apagado» fue justamente
 * la que se quedó diciendo «Movimientos» cuando la otra ya decía «Movimientos y salidas».
 */
function titulosDe(archivo: string): string[] {
  const texto = readFileSync(archivo, "utf8")
  const titulos: string[] = []
  for (const m of texto.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)) {
    const limpio = m[1]
      .replace(/\{[^}]*\}/g, "") // interpolaciones: un número de factura no es un nombre
      .replace(/<[^>]*>/g, "") // iconos
      .replace(/\s+/g, " ")
      .trim()
    if (limpio) titulos.push(limpio)
  }
  for (const m of texto.matchAll(/<PageHeader[\s\S]{0,200}?title="([^"]+)"/g)) titulos.push(m[1])
  return titulos
}

/** Las entradas del menú, tal como se pintan. */
function entradasDelMenu(): Array<{ href: string; label: string }> {
  const out: Array<{ href: string; label: string }> = []
  for (const m of MENU.matchAll(/href:\s*"([^"]+)"[\s\S]{0,120}?label:\s*"([^"]+)"/g)) {
    out.push({ href: m[1], label: m[2] })
  }
  return out
}

describe("el menú de ventas no manda a una pantalla con otro nombre", () => {
  const entradas = entradasDelMenu()

  it("encuentra las diez entradas del menú", () => {
    // Si el menú cambia de forma y el regex deja de leerlo, este archivo pasaría en verde sin
    // comprobar nada. Es el mismo modo de fallo que tenía el cerrojo del ámbar.
    expect(entradas.length).toBe(10)
  })

  it.each(entradasDelMenu())("«$label» lleva a una pantalla que se llama así", ({ href, label }) => {
    const titulos = titulosDe(archivoDeLaRuta(href))
    expect(titulos.length, `${href} no declara ningún título`).toBeGreaterThan(0)
    expect(
      titulos,
      `el menú dice «${label}» y la pantalla se titula ${titulos.map((t) => `«${t}»`).join(" / ")}. ` +
        "El vet que hace clic no sabe si llegó a donde quería.",
    ).toContain(label)
  })
})

describe("la pantalla de la venta se llama «Nueva cuenta», como en OkVet", () => {
  /**
   * ── ACÁ ME EQUIVOQUÉ, Y OKVET ME CORRIGIÓ ────────────────────────────────────────────────────
   *
   * El 27-ago razoné que «Registrar venta» llevando a una pantalla titulada «Nueva cuenta» era una
   * incoherencia —tres rótulos, un destino— y la renombré a «Nueva venta».
   *
   * Está mal. Abierto OkVet ese mismo día: su botón dice **«Registrar venta»** y abre un modal
   * titulado **«Nueva cuenta»**. Exactamente el par que yo había «arreglado». La incoherencia es de
   * OkVet, y copiarla es el objetivo: el pedido del cliente fue copia exacta, y el motivo es que los
   * veterinarios ya saben usar OkVet — cada diferencia, aunque sea una mejora, es algo que
   * reaprenden.
   *
   * O sea que la regla no es «que todo se llame igual»: es «que se llame como en OkVet». Cuando las
   * dos chocan, gana OkVet.
   *
   * Este cerrojo existe para que el próximo que vea la incoherencia lea esto antes de arreglarla.
   */
  it("se titula «Nueva cuenta» y no «Nueva venta»", () => {
    const titulos = titulosDe(join(RAIZ, "src", "app", "dashboard", "facturacion", "nueva", "page.tsx"))
    expect(titulos).toContain("Nueva cuenta")
  })

  it("el modal dice lo mismo que la página", () => {
    // La misma ruta se ve como modal (navegación en cliente) o como página (recarga, enlace
    // pegado). En OkVet también es un modal — `modal-xxl`, abierto desde el libro de ventas.
    const modal = leer("src", "app", "dashboard", "facturacion", "@modal", "(.)nueva", "page.tsx")
    expect(modal).toContain('titulo="Nueva cuenta"')
  })
})

describe("la flecha de volver nombra la sección como la nombra la barra lateral", () => {
  // Decían «Facturación» en seis pantallas y «Inventario» en otras cuatro, para volver a una
  // sección que la barra lateral y la cabecera llaman «Ventas». Y las cuatro que decían
  // «Inventario» volvían a una pantalla que en el menú es HERMANA, no madre: en OkVet «Inventario»
  // es un grupo del menú, no un destino.
  const barra = leer("src", "components", "app-sidebar.tsx")

  it("la barra lateral sigue llamando «Ventas» a la sección", () => {
    expect(barra).toMatch(/title:\s*"Ventas"[\s\S]{0,80}url:\s*"\/dashboard\/facturacion"/)
  })

  it.each([
    "cartera/page.tsx",
    "configuracion/page.tsx",
    "finanzas/page.tsx",
    "inventario/page.tsx",
    "catalogo/page.tsx",
    "compras/page.tsx",
    "inventario/movimientos/page.tsx",
    "inventario/importar/page.tsx",
    "nueva/page.tsx",
    "[id]/page.tsx",
  ])("%s vuelve a «Ventas»", (ruta) => {
    const texto = leer("src", "app", "dashboard", "facturacion", ...ruta.split("/"))
    const vuelta = /href="\/dashboard\/facturacion"[\s\S]{0,260}?<\/Link>/.exec(texto)
    expect(vuelta, `${ruta} no tiene enlace de vuelta al módulo`).not.toBeNull()
    expect(vuelta![0]).toContain("Ventas")
  })
})

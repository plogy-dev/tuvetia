/**
 * Ninguna pantalla de ventas puede quedarse sin puerta.
 *
 * ── LO QUE PASÓ ───────────────────────────────────────────────────────────────────────────────
 *
 * Descubierto el 2026-08-24 comparando contra OkVet. La zona de ventas tenía NUEVE destinos y el
 * menú de la cabecera mostraba CINCO. Los otros cuatro —Compras (con lista, nueva, editar y
 * detalle, todo construido), Proveedores, Salidas y reservas, e Importar catálogo— sólo se
 * alcanzaban entrando primero a Inventario y encontrando un enlace adentro.
 *
 * Un vet que quiere registrar una compra no adivina que el camino es
 * Ventas → Secciones → Inventario → Compras. Para efectos prácticos, esas pantallas no existían.
 *
 * ── POR QUÉ ES UN TEST Y NO UNA NOTA ──────────────────────────────────────────────────────────
 *
 * Esto no se rompe de golpe: se rompe agregando una ruta. Quien crea
 * `facturacion/cotizaciones/page.tsx` la va a poder abrir escribiendo la URL —está trabajando en
 * ella— y no tiene por qué acordarse de un menú que vive en otro archivo. El día que la dé por
 * terminada, nadie más la va a encontrar.
 *
 * Este test se pone en rojo en ese momento, con el nombre de la ruta.
 *
 * ── QUÉ NO EXIGE ──────────────────────────────────────────────────────────────────────────────
 *
 * No pide entrada de menú para lo que se alcanza DESDE su pantalla padre: un detalle (`[id]`), el
 * formulario de creación (`nueva`), la edición y la impresión. Meter eso en el menú sería ruido —
 * nadie busca «editar la compra 7» en un desplegable.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const RAIZ = join("src", "app", "dashboard", "facturacion")
const MENU = readFileSync(join("src", "components", "facturacion", "MenuDeVentas.tsx"), "utf8")

/** Los últimos segmentos que son ACCIONES de su pantalla padre, no destinos del menú. */
const ACCIONES = new Set(["nueva", "editar", "imprimir"])

/**
 * Carpetas que NO son un tramo de URL ni una pantalla propia:
 *
 *   · `@modal` — una ranura paralela. Lo que pinta es OTRA ruta proyectada acá; exigirle entrada de
 *     menú sería pedirle puerta a un reflejo.
 *   · `(.)nueva`, `(..)algo` — rutas interceptoras: la misma URL de siempre, pintada distinto según
 *     cómo se llegue. Su destino real ya está en la lista por su carpeta original.
 *
 * Este caso lo destapó el propio cerrojo: al agregar el modal de «Registrar venta» se puso en rojo
 * señalando `@modal/(.)nueva`, que no es una pantalla huérfana sino una proyección de `nueva`.
 */
function esCarpetaDeRuteo(nombre: string): boolean {
  return nombre.startsWith("@") || /^\((\.{1,3})\)/.test(nombre) || /^\([^.]/.test(nombre)
}

/** Todas las rutas con `page.tsx` bajo `/dashboard/facturacion`. */
function rutas(dir = RAIZ, prefijo = "/dashboard/facturacion"): string[] {
  const out: string[] = []
  for (const entrada of readdirSync(dir)) {
    const completa = join(dir, entrada)
    if (!statSync(completa).isDirectory()) continue
    // Las ranuras y los interceptores no aportan destinos: lo que pintan ya vive en su ruta real.
    if (esCarpetaDeRuteo(entrada)) continue
    const ruta = `${prefijo}/${entrada}`
    try {
      statSync(join(completa, "page.tsx"))
      out.push(ruta)
    } catch {
      // Un directorio sin `page.tsx` es sólo un tramo de la URL; se sigue bajando.
    }
    out.push(...rutas(completa, ruta))
  }
  return out
}

/** Un destino es lo que alguien busca por su nombre: sin `[id]` y sin ser una acción del padre. */
function esDestino(ruta: string): boolean {
  const segmentos = ruta.split("/").slice(3) // después de /dashboard/facturacion
  if (segmentos.some((s) => s.startsWith("["))) return false
  return !ACCIONES.has(segmentos[segmentos.length - 1] ?? "")
}

describe("el menú de ventas llega a todas partes", () => {
  const todas = rutas()

  it("no confunde una ranura paralela con una pantalla huérfana", () => {
    // El modal de «Registrar venta» vive en `@modal/(.)nueva` y proyecta la ruta `nueva`. Si el
    // recorrido lo contara como destino, este cerrojo exigiría meterlo en el menú — que es pedirle
    // puerta a un reflejo.
    expect(todas.some((r) => r.includes("@modal") || r.includes("(.)"))).toBe(false)
  })

  it("encuentra las pantallas de ventas", () => {
    // Si esto se rompe, el recorrido dejó de funcionar y los demás casos pasarían en verde vacío —
    // que es exactamente cómo un cerrojo se muere sin que nadie se entere.
    expect(todas.length).toBeGreaterThan(8)
    expect(todas).toContain("/dashboard/facturacion/compras")
  })

  it("TODO DESTINO ESTÁ EN EL MENÚ", () => {
    const destinos = todas.filter(esDestino)
    const huerfanas = destinos.filter((r) => !MENU.includes(`"${r}"`))
    expect(
      huerfanas,
      `estas pantallas existen y no se pueden encontrar desde el menú de ventas:\n  ${huerfanas.join("\n  ")}`,
    ).toEqual([])
  })

  it("la lista de ventas también está en el menú, como en la referencia", () => {
    // OkVet incluye «Ventas, recibos y facturas» dentro de su propio menú: estando en otra sección
    // hay que poder volver sin usar el botón de atrás.
    expect(MENU).toContain('"/dashboard/facturacion"')
  })

  it("no mete en el menú lo que se alcanza desde su pantalla padre", () => {
    // Un detalle o un «nueva» en el desplegable es ruido: nadie busca «editar la compra 7» ahí.
    for (const accion of ["/dashboard/facturacion/nueva", "/dashboard/facturacion/compras/nueva"]) {
      expect(MENU, `«${accion}» no debería estar en el menú`).not.toContain(`"${accion}"`)
    }
  })
})

describe("los nombres son los de la referencia", () => {
  // Los veterinarios ya saben usar OkVet: cada palabra distinta es una que reaprenden. Y «Finanzas»
  // ni siquiera coincidía con el propio `h1` de esa página, que dice «Ingresos y egresos».
  it.each([
    ["Ventas, recibos y facturas", "/dashboard/facturacion"],
    ["Ingresos y egresos", "/dashboard/facturacion/finanzas"],
    ["Productos y servicios", "/dashboard/facturacion/catalogo"],
    ["Salidas y reservas", "/dashboard/facturacion/inventario/movimientos"],
    ["Compras", "/dashboard/facturacion/compras"],
    ["Proveedores", "/dashboard/facturacion/compras/proveedores"],
    ["Configuración de facturación", "/dashboard/facturacion/configuracion"],
  ])("«%s» apunta a %s", (etiqueta, ruta) => {
    const i = MENU.indexOf(`"${ruta}"`)
    expect(i, `no se encontró ${ruta} en el menú`).toBeGreaterThan(-1)
    // La etiqueta va junto a su href dentro de la misma entrada del arreglo.
    expect(MENU.slice(i, i + 220)).toContain(etiqueta)
  })
})

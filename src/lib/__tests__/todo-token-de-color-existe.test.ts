/**
 * Ningún `var(--…)` escrito en TypeScript apunta a una variable que no existe.
 *
 * ── EL FALLO, encontrado en la auditoría de UI del 27-ago ──────────────────────────────────────
 *
 * `lib/agenda/tipos-de-cita.ts` pintaba «Peluquería o spa» con `var(--color-amber)` y
 * `lib/tablero/cumplimiento.ts` pintaba el arco de «fuera de ritmo» con lo mismo. Ese token NO
 * EXISTE: el `@theme inline` de `globals.css` expone `--color-warn`, y `--color-amber` no está en
 * ningún lado. Un `var()` sin valor hace que el navegador DESCARTE la declaración entera, así que
 * la peluquería quedaba sin fondo y el aviso de «vas corto» sin su color de atención — o sea que la
 * única señal de alarma del tablero no aparecía.
 *
 * ── POR QUÉ NO LO VIO NADIE ────────────────────────────────────────────────────────────────────
 *
 * Porque no falla en ningún lado. TypeScript ve una cadena, el build de Tailwind ni se entera —esto
 * no es una clase, es un valor de estilo en línea— y el navegador no avisa. Y el cerrojo que ya
 * existía sobre esa función, `cumplimiento-de-la-meta.test.ts`, afirmaba
 * `expect(c.color).toBe("var(--color-amber)")`: comparaba LA CADENA, no el efecto, así que pasaba en
 * verde con la función rota. Un test puede fijar un defecto igual de bien que fija un acierto.
 *
 * Este mira el otro lado: que el nombre esté declarado en algún sitio. Es barato —lee archivos y
 * compara nombres— y atrapa toda la familia, no el caso que ya se arregló.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

const archivos = () =>
  readdirSync(RAIZ, { recursive: true, encoding: "utf8" })
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /\.(css|ts|tsx)$/.test(f))

/**
 * Variables que NO se declaran en el repo y aun así son legítimas.
 *
 * Cada una tiene que caer en uno de tres casos, y si no cae en ninguno es un defecto:
 *
 *   · LAS PONE TAILWIND. `--spacing` y las `--font-*` salen de su tema por defecto.
 *   · LAS PONE UNA LIBRERÍA EN TIEMPO DE EJECUCIÓN. Vaul escribe las `--drawer-*` y las de la pila
 *     sobre el nodo del cajón mientras se arrastra; leerlas desde el CSS es justamente el contrato.
 *   · SE ESCRIBEN Y SE LEEN EN EL MISMO ARCHIVO por `style={{ … }}`, que este barrido no ve porque
 *     ahí la declaración no lleva la forma `--x:` de CSS.
 */
const PERMITIDAS = new Set([
  // Tema de Tailwind
  "--spacing",
  "--font-archivo",
  "--font-serif",
  "--font-mono-landing",
  // Vaul las escribe sobre el nodo del cajón mientras se arrastra
  "--drawer-overlay-min-opacity",
  "--drawer-swipe-progress",
  "--drawer-swipe-strength",
  "--drawer-swipe-movement-x",
  "--drawer-swipe-movement-y",
  "--drawer-snap-point-offset",
  "--drawer-height",
  "--drawer-frontmost-height",
  "--drawer-inset",
  "--nested-drawers",
  "--stack-scale",
  "--stack-scale-base",
  "--stack-progress",
  "--stack-step",
  "--stack-peek-offset",
  "--stack-shrink",
  "--stack-height",
  "--peek",
  "--translate-x",
  "--translate-y",
  // Se declaran con `style={{ … }}` en el mismo archivo que las lee
  "--header-height", // dashboard/layout.tsx
  "--sidebar-width", // ui/sidebar.tsx
  "--sidebar-width-icon", // ui/sidebar.tsx
  "--gap", // ui/toggle-group.tsx
])

/** Nombres armados por interpolación (`--chart-${n}`): el barrido no puede resolverlos. */
const ES_PLANTILLA = /-$/

/**
 * Fuera los comentarios antes de buscar usos.
 *
 * Este repo documenta sus decisiones DENTRO del código, y varios comentarios citan tokens al
 * explicar por qué se dejaron de usar — `cumplimiento-de-ventas.tsx` cuenta que `--color-bg-subtle`
 * no existía y por eso se cambió. Sin esto, el barrido leería esa explicación como el defecto que la
 * explicación dice haber arreglado.
 */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n")
}

describe("todo var(--…) apunta a algo que existe", () => {
  it("ninguna variable usada desde TypeScript está sin declarar", () => {
    const declaradas = new Set<string>()
    const usadas = new Map<string, Set<string>>()

    for (const ruta of archivos()) {
      const texto = readFileSync(join(RAIZ, ruta), "utf8")

      // Declaraciones: `--x:` en CSS, y también en los objetos `style` de TSX (`"--x": …`).
      for (const m of texto.matchAll(/(?:^|[;{\s"'])(--[a-zA-Z0-9_-]+)\s*:/g)) declaradas.add(m[1])

      if (ruta.endsWith(".css")) continue
      // Los tests son fixtures: inventan nombres a propósito para probar el resolvedor.
      if (ruta.includes("__tests__/")) continue

      for (const m of sinComentarios(texto).matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
        if (!usadas.has(m[1])) usadas.set(m[1], new Set())
        usadas.get(m[1])!.add(ruta)
      }
    }

    const huerfanas = [...usadas]
      .filter(([n]) => !declaradas.has(n) && !PERMITIDAS.has(n) && !ES_PLANTILLA.test(n))
      .map(([n, donde]) => `${n} → ${[...donde].join(", ")}`)

    expect(
      huerfanas,
      "un var() sin declarar hace que el navegador descarte la declaración entera y en pantalla " +
        "no queda NINGUNA señal: el bloque sale sin color y nadie se entera",
    ).toEqual([])
  })
})

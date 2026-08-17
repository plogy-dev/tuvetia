// El contraste de la escala de tinta, medido sobre `globals.css` de verdad.
//
// POR QUÉ EXISTE. La auditoría del 2026-08-16 encontró que `fg-faint` daba **2.95:1** sobre blanco
// donde WCAG AA pide 4.5:1 para texto normal — y son 216 usos, ninguno lo bastante grande para el
// umbral de 3:1 del texto grande. El modo oscuro, en cambio, pasaba con holgura: se había afinado
// esa paleta y no la clara. Nada lo detectó porque **el contraste no es algo que un test de
// componente pueda fallar**: no hay assertion natural sobre "esto se lee".
//
// Así que este test lee el CSS, resuelve los tokens y hace la cuenta. Es el único lugar del repo
// donde una regresión de accesibilidad de color puede romper CI en vez de descubrirse cuando alguien
// no puede leer un rótulo.
//
// SE MIDE CONTRA `surface-2` ADEMÁS DEL FONDO porque es el más exigente de los dos: las cards y las
// bandas elevadas son nieve, no blanco puro, y un token que pasa sobre blanco puede no pasar ahí.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")

/** WCAG 2.1 §1.4.3: texto normal necesita 4.5:1. El texto grande (≥24px, o ≥18.66px en negrita) se
 *  conforma con 3:1 — pero ningún uso de esta escala llega a ese tamaño, así que la vara es 4.5. */
const AA_TEXTO_NORMAL = 4.5

// ── Leer los tokens del CSS ───────────────────────────────────────────────────────────────────

/** El cuerpo de un bloque, contando llaves: los bloques anidan y un regex perezoso corta de más. */
function bloque(selector: string): string {
  const inicio = CSS.indexOf(selector)
  if (inicio === -1) throw new Error(`no se encontró el selector ${selector} en globals.css`)
  const abre = CSS.indexOf("{", inicio)
  let nivel = 0
  for (let i = abre; i < CSS.length; i++) {
    if (CSS[i] === "{") nivel++
    else if (CSS[i] === "}" && --nivel === 0) return CSS.slice(abre + 1, i)
  }
  throw new Error(`el bloque ${selector} no cierra`)
}

/** `--nombre: valor;` de un bloque, con los comentarios fuera. */
function tokens(cuerpo: string): Record<string, string> {
  const limpio = cuerpo.replace(/\/\*[\s\S]*?\*\//g, "")
  const out: Record<string, string> = {}
  for (const m of limpio.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1]] = m[2].trim()
  }
  return out
}

/** Resuelve `var(--x)` mirando primero el bloque propio y cayendo a `:root` (donde vive la paleta). */
function resolver(nombre: string, propios: Record<string, string>, base: Record<string, string>): string {
  let v = propios[nombre] ?? base[nombre]
  for (let i = 0; v && i < 5; i++) {
    const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(v)
    if (!ref) break
    v = propios[ref[1]] ?? base[ref[1]]
  }
  if (!v) throw new Error(`no se pudo resolver ${nombre}`)
  return v
}

// ── Color ─────────────────────────────────────────────────────────────────────────────────────

function aRgb(valor: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(valor.trim())
  if (hex) {
    const n = hex[1]
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number]
  }
  const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(valor.trim())
  if (hsl) {
    const h = Number(hsl[1]) / 360
    const s = Number(hsl[2]) / 100
    const l = Number(hsl[3]) / 100
    const k = (n: number) => (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return [f(0) * 255, f(8) * 255, f(4) * 255] as [number, number, number]
  }
  throw new Error(`formato de color no soportado: ${valor}`)
}

/** Luminancia relativa, WCAG 2.1 §relative-luminance. */
function luminancia([r, g, b]: [number, number, number]): number {
  const c = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}

function contraste(a: string, b: string): number {
  const [hi, lo] = [luminancia(aRgb(a)), luminancia(aRgb(b))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ── Las dos paletas ───────────────────────────────────────────────────────────────────────────

const RAIZ = tokens(bloque(":root {"))
const OSCURO = tokens(bloque(".dark,"))

/** Los tres niveles de tinta, con el nombre de la utilidad que los pinta. */
const ESCALA = [
  { utilidad: "text-fg", token: "--text" },
  { utilidad: "text-fg-muted", token: "--text-2" },
  { utilidad: "text-fg-faint", token: "--muted" },
] as const

function paleta(propios: Record<string, string>) {
  const tinta = ESCALA.map((n) => ({ ...n, color: resolver(n.token, propios, RAIZ) }))
  return {
    tinta,
    fondo: resolver("--background", propios, RAIZ),
    superficie2: resolver("--surface-2", propios, RAIZ),
  }
}

describe.each([
  ["claro", RAIZ],
  ["oscuro", OSCURO],
])("la escala de tinta en modo %s", (_modo, propios) => {
  const { tinta, fondo, superficie2 } = paleta(propios)

  it.each(tinta)("$utilidad se lee sobre el fondo de página", ({ color }) => {
    expect(contraste(color, fondo)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL)
  })

  // El fondo más exigente de los dos: las cards y las bandas elevadas no son blanco puro.
  it.each(tinta)("$utilidad se lee sobre surface-2", ({ color }) => {
    expect(contraste(color, superficie2)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL)
  })

  // LO QUE SE PERDERÍA CON EL ARREGLO INGENUO. Subir `--muted` sólo hasta que pasara lo habría
  // dejado a 5.31 contra el 5.48 de `--text-2`: dos tonos indistinguibles y la jerarquía de tres
  // niveles colapsada en dos. Hay sitios donde el color es el ÚNICO diferenciador —el `120/500` del
  // medidor de cupo, donde el total tiene que retroceder frente al consumo.
  it("los tres niveles se distinguen entre sí", () => {
    const ratios = tinta.map((n) => contraste(n.color, fondo))
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i - 1] / ratios[i]).toBeGreaterThan(1.25)
    }
  })
})

// Los colores que NO son tinta pero se usan como texto: el menta de los enlaces y los de estado.
//
// `--accent-text` existe justamente por esto — su comentario en `globals.css` dice que el menta 500
// sobre blanco no llega a AA, así que para texto se usa el 700. Ese razonamiento estaba escrito y no
// verificado por nada; acá queda fijado. Los pares `*-soft` quedan fuera a propósito: en modo oscuro
// son `rgba()` con alfa, y medirlos bien exige componer sobre el fondo, que es otro problema.
describe.each([
  ["claro", RAIZ],
  ["oscuro", OSCURO],
])("los colores de acento y estado en modo %s", (_modo, propios) => {
  const fondo = resolver("--background", propios, RAIZ)

  it.each([
    ["text-brand-text", "--accent-text"],
    ["text-danger", "--danger"],
    ["text-warn", "--warn"],
  ])("%s se lee sobre el fondo de página", (_utilidad, token) => {
    expect(contraste(resolver(token, propios, RAIZ), fondo)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL)
  })
})

describe("los dos sistemas de tokens no se separan", () => {
  // `text-muted-foreground` (275 usos, shadcn) y `text-fg-muted` (227, el sistema propio) son el
  // MISMO nivel de la escala. Con tonos distintos, el texto secundario cambiaría de color según qué
  // componente lo pinte.
  it.each([
    ["claro", RAIZ],
    ["oscuro", OSCURO],
  ])("en modo %s, --ui-muted-foreground es el mismo tono que --text-2", (_modo, propios) => {
    const a = aRgb(resolver("--text-2", propios, RAIZ))
    const b = aRgb(resolver("--ui-muted-foreground", propios, RAIZ))
    // Tolerancia de 3 por canal, y no de 1, porque los dos bloques se escriben en formatos distintos
    // —uno en hex y otro en `hsl()`— y el redondeo de la conversión ya difiere en ~2 en el modo
    // oscuro, donde los colores SÍ son el mismo desde antes de este test. Sigue siendo estricta para
    // lo que importa: dos niveles distintos de la escala se separan más de 20 por canal.
    for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(3)
  })
})

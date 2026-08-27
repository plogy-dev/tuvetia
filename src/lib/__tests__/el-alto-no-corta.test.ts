/**
 * El barrido de desbordes: las familias mecánicas, no un archivo a la vez.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE ────────────────────────────────────────────────────────────────
 *
 * En dos días —26 y 27 de agosto— el cliente reportó CUATRO desbordes, y cada uno se diagnosticó
 * desde cero:
 *
 *   «la barra lateral esconde contenido»   → el alto del pie, sin señal de scroll
 *   «la agenda está completamente          → «Hoy» era `shrink-0` contra un piso de 420 px
 *    desbordada»
 *   «el chat se lleva la cabecera»         → riel con `overflow-auto` y sin `min-h-0`
 *   «aparece en todo»                      → `SidebarProvider` era `min-h-svh`: el shell nunca acotó
 *
 * Y `el-ancho-no-corta.test.ts` tiene hoy dieciocho cerrojos, TODOS de un archivo cada uno:
 * «SidebarInset lleva min-w-0», «el riel puede encogerse», «Hoy puede encogerse». Cada uno se
 * escribió DESPUÉS del reporte y ninguno generaliza — el defecto número diecinueve, en el archivo
 * diecinueve, no lo atrapa nadie. El problema no era que faltaran arreglos: era que la detección
 * llegaba siempre después del cliente.
 *
 * Esto mira FAMILIAS. No sabe de la agenda ni del chat: sabe qué combinaciones de clases hacen que
 * un contenedor no pueda encoger, y las busca en todo el árbol.
 *
 * ── POR QUÉ VITEST Y NO UN SCRIPT ──────────────────────────────────────────────────────────────
 *
 * `scripts/auditar-esquema-usado.mjs` es un script porque necesita una base de datos viva. Esto sólo
 * necesita el código fuente, así que entra solo en `npm run verify`, en `scripts/auditoria.py` —que
 * ya corre `front · vitest`— y en CI, sin que nadie tenga que acordarse de invocarlo.
 *
 * ── LO QUE NO PUEDE VER, DICHO ─────────────────────────────────────────────────────────────────
 *
 * Un barrido de texto no sabe la DIRECCIÓN del padre, así que no puede juzgar `min-w-0`: la misma
 * clase que es un defecto en una fila es irrelevante en una columna. Por eso acá sólo se vigila el
 * eje vertical, que es donde cayeron los cuatro reportes. El ancho lo sigue cubriendo
 * `el-ancho-no-corta.test.ts`, archivo por archivo, y la medición en el navegador es la que dice
 * cuál desborda DE VERDAD.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

const tsx = () =>
  readdirSync(RAIZ, { recursive: true, encoding: "utf8" })
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => f.endsWith(".tsx"))

/** Los comentarios de este repo citan clases al explicar decisiones; leerlos daría falsos positivos. */
const sinComentarios = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n")

/** Cada `className` del archivo, con su línea. Cubre `"…"`, `` {`…`} `` y `{"…"}`. */
function clases(texto: string): Array<{ cls: string; linea: number }> {
  const out: Array<{ cls: string; linea: number }> = []
  for (const m of texto.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
    out.push({
      cls: m[1] ?? m[2] ?? m[3] ?? "",
      linea: texto.slice(0, m.index).split("\n").length,
    })
  }
  return out
}

// ── Familia 1 · un scroller que no puede encoger ─────────────────────────────────────────────────

/**
 * Casos donde el `flex-1` con scroll SÍ puede encoger aunque no diga `min-h-0`.
 *
 * `min-h-40` (o cualquier `min-h-*` explícito) sustituye al mínimo automático: el contenedor no baja
 * de ese piso, pero tampoco crece con su contenido, que es la parte que rompe.
 */
const PISO_EXPLICITO = /\bmin-h-(?!0\b)[\w.[\]%-]+/

describe("todo scroller vertical puede encogerse", () => {
  it("ningún flex-1 con overflow-y se queda sin min-h-0", () => {
    const culpables: string[] = []
    for (const ruta of tsx()) {
      const texto = sinComentarios(readFileSync(join(RAIZ, ruta), "utf8"))
      for (const { cls, linea } of clases(texto)) {
        const scrollea = /\boverflow-(y-)?(auto|scroll)\b/.test(cls)
        const crece = /\bflex-1\b|\bgrow\b/.test(cls)
        if (!scrollea || !crece) continue
        if (/\bmin-h-0\b/.test(cls) || PISO_EXPLICITO.test(cls)) continue
        culpables.push(`${ruta}:${linea} → ${cls.slice(0, 100)}`)
      }
    }
    expect(
      culpables,
      "en una columna flex, un hijo con `flex-1` no baja de su contenido salvo que se le diga: " +
        "sin `min-h-0` el `overflow` nunca llega a activarse y el contenido empuja en vez de scrollear",
    ).toEqual([])
  })
})

// ── Familia 2 · el layout que corta la cadena de alto ────────────────────────────────────────────

describe("los layouts del dashboard pasan el alto", () => {
  it("un layout intermedio que envuelve children en columna flex lleva flex-1 y min-h-0", () => {
    // Es el defecto que rompió Comunicaciones el 27-ago. Las pantallas del dashboard abren con
    // `min-h-0 flex-1` porque el alto lo da el shell; un layout que se mete en el medio con un
    // `flex flex-col` de alto `auto` deja ese `flex-1` sin nada contra qué medir, y los `overflow`
    // de adentro —cuatro, en el caso de las bandejas— dejan de activarse.
    //
    // Envolver en un fragmento o devolver `children` tal cual NO cuenta: ahí no hay elemento propio
    // y la cadena pasa intacta. Es lo que hacen los otros tres layouts del dashboard.
    const culpables: string[] = []
    for (const ruta of tsx()) {
      if (!/^app\/dashboard\/.+\/layout\.tsx$/.test(ruta)) continue
      const texto = sinComentarios(readFileSync(join(RAIZ, ruta), "utf8"))
      if (!/\{children\}/.test(texto)) continue
      for (const { cls, linea } of clases(texto)) {
        if (!/\bflex\b/.test(cls) || !/\bflex-col\b/.test(cls)) continue
        if (/\bflex-1\b/.test(cls) && /\bmin-h-0\b/.test(cls)) continue
        culpables.push(`${ruta}:${linea} → ${cls.slice(0, 100)}`)
      }
    }
    expect(
      culpables,
      "un layout con alto `auto` entre el shell y la pantalla deja el `flex-1` de la pantalla sin " +
        "referencia: pasa el alto con `flex-1 min-h-0`, o no envuelvas en un elemento propio",
    ).toEqual([])
  })
})

// ── Familia 4 · un piso que no cabe ──────────────────────────────────────────────────────────────

/**
 * El techo de cualquier `min-h-[Npx]`, y sale de una cuenta, no de un gusto.
 *
 * El portátil del cliente mide 768 px de alto. Descontando la cabecera (48) y el `m-2` del
 * `SidebarInset` (16), al área de contenido le quedan **704**. De ahí, una pantalla típica ya gasta
 * ~64 en su padding, ~60 en una franja de aviso y ~32 en dos huecos: quedan unos **550** para
 * repartir entre TODOS los bloques con piso.
 *
 * Un solo piso de 320 se lleva el 58 % de eso y todavía deja lugar para un segundo bloque. Uno de
 * 480 no: garantiza el desborde con cualquier hermano, en todos los portátiles, siempre.
 *
 * Y eso no es hipotético. El 27-ago la grilla de la agenda subió su piso de 220 a 480 con un
 * argumento razonable —siete horas de jornada a 72 px por hora— y el resultado fue que la página
 * volvió a desplazarse entera: 64 + 60 + 16 + 104 + 16 + 480 = 740 contra 704 disponibles. El
 * cliente lo reportó con las mismas palabras de las dos veces anteriores.
 */
const TOPE_DE_PISO = 320

describe("ningún piso en píxeles se come la pantalla", () => {
  it("todo min-h-[Npx] cabe en el área de contenido de un portátil", () => {
    const culpables: string[] = []
    for (const ruta of tsx()) {
      const texto = sinComentarios(readFileSync(join(RAIZ, ruta), "utf8"))
      for (const { cls, linea } of clases(texto)) {
        for (const m of cls.matchAll(/min-h-\[(\d+)px\]/g)) {
          const px = Number(m[1])
          if (px > TOPE_DE_PISO) culpables.push(`${ruta}:${linea} → min-h-[${px}px]`)
        }
      }
    }
    expect(
      culpables,
      `un piso mayor a ${TOPE_DE_PISO}px no deja lugar a sus hermanos en un portátil de 768: la ` +
        "columna deja de repartirse, crece, y el desplazamiento vuelve a la página entera",
    ).toEqual([])
  })
})

// ── Familia 3 · texto de usuario que no parte ────────────────────────────────────────────────────

describe("las burbujas de conversación parten el texto largo", () => {
  it("toda burbuja con ancho máximo en porcentaje lleva break-words", () => {
    // Los titulares mandan enlaces sin un solo espacio. Una palabra sin puntos de corte no cabe en
    // el `max-w-[80%]`, se sale de la burbuja y —porque una columna de grilla no encoge por debajo
    // de su contenido— manda la bandeja entera a scroll horizontal.
    //
    // `truncate` también sirve y es lo correcto para una línea suelta (un nombre en una fila): ahí
    // no se quiere que el texto crezca hacia abajo. Se acepta como alternativa.
    const culpables: string[] = []
    for (const ruta of tsx()) {
      const texto = sinComentarios(readFileSync(join(RAIZ, ruta), "utf8"))
      for (const { cls, linea } of clases(texto)) {
        if (!/\bmax-w-\[\d+%\]/.test(cls)) continue
        if (/\bbreak-words\b|\bbreak-all\b|\bwrap-anywhere\b|\btruncate\b|\bline-clamp-/.test(cls)) continue
        culpables.push(`${ruta}:${linea} → ${cls.slice(0, 100)}`)
      }
    }
    expect(
      culpables,
      "una URL sin espacios no cabe en el ancho de la burbuja y empuja la pantalla a lo ancho",
    ).toEqual([])
  })
})

/**
 * Ningún correo de Tuvetia vuelve a salir en texto plano.
 *
 * ── DE DÓNDE SE VIENE ─────────────────────────────────────────────────────────────────────────
 *
 * Hasta el 27-ago TODO el correo que salía de esta aplicación era texto plano. No cinco de
 * seis: los cinco de cinco. La invitación al equipo, la factura al cliente, el recordatorio
 * de cobranza, el aviso a los titulares y el masivo de plataforma — ninguno pasaba `html` al
 * transporte. Se midió antes de tocar nada: cero usos de `html` en todos los sitios de envío.
 *
 * Y no fue una decisión de nadie. El primitivo estaba **al revés**: `ResendInput` pedía `text:
 * string` obligatorio y ofrecía `html?: string | null` opcional, así que el camino corto —el que
 * deja pasar el tipo— era el que producía un correo sin marca, sin jerarquía, sin un botón donde
 * apretar y con peor cara ante un filtro de spam. Cinco archivos distintos, escritos en momentos
 * distintos por gente distinta, tomaron los cinco el mismo camino corto. Eso no es descuido: es el
 * tipo diciendo qué se espera.
 *
 * El 28-ago se migró entero. `html` pasó a ser obligatorio, `text` pasó a opcional y a
 * DERIVARSE del HTML en el transporte, y apareció una envoltura única —`lib/email/maqueta.ts`—
 * por la que pasan los cinco sitios.
 *
 * ── POR QUÉ ESTE TEST LEE LA FUENTE ───────────────────────────────────────────────────────────
 *
 * Porque un correo mal armado NO FALLA. Sale, se entrega, y se ve mal en la bandeja de alguien que
 * no trabaja acá. No hay excepción, ni pantalla roja, ni línea en el log: se entera el veterinario,
 * o el titular que lo recibió, o nadie. En CI no hay forma de probar un correo real —haría
 * falta una casilla de verdad, un cliente de verdad y un par de ojos— así que lo único que
 * se puede vigilar barato es la FORMA del código que lo arma.
 *
 * Y el modo de volver atrás no es dramático, es de una línea. Alguien que pelea con un test
 * o con un tipo escribe `html?: string` en `ResendInput` para salir del paso, y a partir de
 * ahí cada correo nuevo puede omitirlo — igual que antes, y sin que nada se ponga en rojo,
 * porque el correo sigue saliendo. La regresión es invisible por construcción. Este archivo
 * es lo que la vuelve ruidosa.
 *
 * Es la misma clase de regla que `panel-admin-cerrado` y `navegacion-sin-recargar`: lo que hay que
 * fijar no es un valor de salida sino una propiedad del código, y eso se mira leyéndolo.
 *
 * ── QUÉ SE FIJA, Y POR QUÉ ESAS TRES COSAS ────────────────────────────────────────────────────
 *
 *   1. Que `html` siga siendo OBLIGATORIO en las tres puertas (el transporte y los dos remitentes).
 *      Es la pieza que sostiene todas las demás: si vuelve a ser opcional, el resto se cae en
 *      silencio y sin que ningún otro test lo note.
 *   2. Que ningún sitio de envío arme su correo por su cuenta. La maqueta compartida es lo que hace
 *      que mover el verde de marca o agregar una línea al pie sea un cambio y no cinco.
 *   3. Que dentro del HTML del correo no haya `var(--…)` ni colores en formato CSS moderno.
 *      Del otro lado no existe `globals.css` y el cliente no es un navegador: una variable
 *      sin resolver o un `oklch()` hacen que la declaración se descarte entera y el elemento
 *      quede sin color.
 *
 * Lo que NO está acá porque ya está probado de verdad en `lib/email/__tests__/maqueta.test.ts`: el
 * escapado de los datos, el preheader oculto y la derivación a texto plano. Eso se ejecuta y se
 * mira la salida, que siempre es mejor que leer el código. Acá sólo va lo que no se puede ejecutar.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")
const DIR_EMAIL = join(RAIZ, "lib", "email")
const MAQUETA = join(DIR_EMAIL, "maqueta.ts")
const RESEND = join(DIR_EMAIL, "resend.ts")
const GLOBALS = join(RAIZ, "app", "globals.css")

/** Ruta corta, para que el nombre del caso diga dónde mirar y no medio disco. */
const corta = (p: string) => relative(process.cwd(), p).split(sep).join("/")

const fuente = (p: string) => readFileSync(p, "utf8")

/**
 * Quita los comentarios antes de buscar.
 *
 * HACE FALTA Y ESTE ARCHIVO ES LA PRUEBA: el comentario de `maqueta.ts` dice «NADA DE `var(--…)`»
 * para explicar la regla, y un escáner ingenuo lo leería como una violación. Documentar la regla la
 * rompería. Lo mismo con `plantillas.ts`, que cita `<p style="…">` justo para decir que ahí no va.
 *
 * El `[^:]` antes de las dos barras protege a `https://`: sin eso, `const API =
 * "https://api.resend.com/emails"` se comería media línea de código real.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const codigoDe = (p: string) => sinComentarios(fuente(p))

function archivosDe(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    // Los tests quedan fuera: mockean las puertas de envío y arman HTML de mentira a propósito.
    if (e.isDirectory()) {
      if (e.name !== "__tests__") archivosDe(p, out)
    } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) {
      out.push(p)
    }
  }
  return out
}

// ── Quiénes mandan correo ─────────────────────────────────────────────────────────────────────
//
// LA LISTA NO SE ESCRIBE A MANO, se descubre. Es la diferencia entre este test y un comentario: un
// sexto sitio de envío escrito el mes que viene entra solo al escaneo y tiene que cumplir las
// mismas reglas. Una lista fija sólo protegería a los cinco que hoy ya están bien.
//
// Las tres son las puertas por las que sale todo: `sendViaResend` es el transporte y las otras dos
// los remitentes que lo envuelven (plataforma y en nombre de una clínica). Ver CORREOS.md.
//
// DOS CAMINOS QUEDAN AFUERA, y conviene dejar dicho cuáles para que nadie los busque acá:
//
//   · `composio/correo.ts` manda desde la casilla del propio veterinario por Gmail/Outlook, no por
//     Resend. Ese correo lo escribe una persona; éstos los escribe el sistema.
//   · El del enlace mágico (`signInWithOtp`, en los formularios de acceso) lo redacta y lo manda
//     Supabase Auth con su plantilla, que vive en su panel y no en este repositorio. Sigue siendo
//     el único correo de Tuvetia que este test no puede vigilar — no porque se haya salteado la
//     migración, sino porque no hay fuente que leer.
const PUERTAS = /\b(?:sendViaResend|sendPlatformEmail|sendTransactionalEmail)\s*\(/

const sitiosDeEnvio = archivosDe(RAIZ)
  // `lib/email/` es la maquinaria, no un sitio de envío: no arma correos, los despacha.
  .filter((p) => !p.startsWith(DIR_EMAIL + sep))
  .filter((p) => PUERTAS.test(codigoDe(p)))

/**
 * Dónde NO puede haber HTML de correo escrito a mano: los sitios de envío y toda la maquinaria de
 * `lib/email/` salvo la envoltura misma.
 *
 * `components/email/cuerpo-del-correo.tsx` queda fuera a propósito, y conviene decirlo porque
 * también arma un documento HTML entero: ese es el correo que ENTRA —lo pinta la bandeja dentro de
 * un iframe— y no tiene nada que ver con lo que Tuvetia manda.
 */
const caminoDeEnvio = [...sitiosDeEnvio, ...archivosDe(DIR_EMAIL).filter((p) => p !== MAQUETA)]

/** El cuerpo de un `interface X {` o `type X = {`, hasta la llave que lo cierra en la columna 0. */
function cuerpoDelTipo(codigo: string, nombre: string): string {
  const inicio = codigo.search(new RegExp(`(?:interface|type)\\s+${nombre}\\b[^{]*\\{`))
  if (inicio === -1) return ""
  const fin = codigo.indexOf("\n}", inicio)
  return fin === -1 ? codigo.slice(inicio) : codigo.slice(inicio, fin)
}

// Las tres puertas y el archivo donde vive el tipo de entrada de cada una: el transporte, el
// remitente de plataforma y el que firma en nombre de una clínica. Las tres tienen que exigir HTML:
// alcanzaría con que UNA lo aflojara para que por ahí volviera a salir texto plano.
const TIPOS_DE_ENTRADA: [string, string][] = [
  ["resend.ts", "ResendInput"],
  ["platform-sender.ts", "PlatformEmailInput"],
  ["transactional.ts", "TransactionalInput"],
]

const tipoDeLaPuerta = (archivo: string, tipo: string) =>
  cuerpoDelTipo(codigoDe(join(DIR_EMAIL, archivo)), tipo)

describe("el tipo no deja escribir un correo sin HTML", () => {
  it.each(TIPOS_DE_ENTRADA)("%s · %s exige `html`", (archivo, tipo) => {
    const cuerpo = tipoDeLaPuerta(archivo, tipo)

    // Un cuerpo vacío significa que el tipo se renombró o se fue. Falla igual, y debe: el escaneo
    // que no encuentra lo que vigila no está protegiendo nada.
    expect(cuerpo, `${archivo}: no se encontró el tipo ${tipo}`).not.toBe("")
    expect(cuerpo, `${tipo}.html tiene que ser \`html: string\`, obligatorio`).toMatch(
      /\bhtml\s*:\s*string\b/,
    )
  })

  // EL SIGNO DE PREGUNTA ES TODO EL BUG, dado vuelta. Con `html?: string` el correo sigue saliendo
  // —en texto plano, como salía antes— y no hay ningún otro test que se entere.
  it.each(TIPOS_DE_ENTRADA)("%s · %s NO vuelve a hacer `html` opcional", (archivo, tipo) => {
    const cuerpo = tipoDeLaPuerta(archivo, tipo)
    expect(cuerpo).not.toBe("")
    expect(
      /\bhtml\s*\?\s*:/.test(cuerpo),
      `${tipo}.html volvió a ser opcional: eso es exactamente el estado del que se venía`,
    ).toBe(false)
  })

  // La otra mitad del mismo intercambio: `text` dejó de ser obligatorio PORQUE se deriva del HTML.
  // Si esa derivación desaparece, `text` vuelve a hacer falta a mano en cada sitio y el texto plano
  // empieza a poder decir algo distinto del HTML — el defecto clásico del correo multipart.
  it("el transporte sigue derivando la versión en texto del mismo HTML", () => {
    expect(codigoDe(RESEND)).toContain("textoDelCorreo(input.html)")
  })
})

describe("nadie arma un correo por fuera de la maqueta compartida", () => {
  it("el escaneo encuentra sitios de envío (si esto falla, dejó de mirar donde debe)", () => {
    expect(sitiosDeEnvio.map(corta)).not.toHaveLength(0)
  })

  // Las comillas van en los dos sabores porque el repo tiene las dos: `lib/facturacion/` y
  // `lib/cartera/` usan simples y punto y coma, el resto dobles y sin. Un test que exigiera un solo
  // estilo estaría fijando una convención de formato en vez de la regla que le importa.
  const IMPORTA_LA_MAQUETA = /from\s+["']@\/lib\/email\/maqueta["']/

  it.each(sitiosDeEnvio.map(corta))("%s importa la maqueta compartida", (rel) => {
    // El origen importa tanto como la llamada: una copia local del armado vuelve a partir en cinco
    // el cambio de una coma en el pie.
    expect(codigoDe(join(process.cwd(), rel))).toMatch(IMPORTA_LA_MAQUETA)
  })

  it.each(sitiosDeEnvio.map(corta))("%s pasa por `maquetarCorreo`", (rel) => {
    expect(codigoDe(join(process.cwd(), rel))).toMatch(/\bmaquetarCorreo\s*\(/)
  })

  // ── HTML de correo escrito a mano ───────────────────────────────────────────────────────────
  //
  // Las marcas son las de una maqueta de correo, no las de una pantalla: tablas con `cellpadding`,
  // `bgcolor` y estilos en línea. En la app nadie escribe así —hay clases y componentes—, así que
  // encontrarlas fuera de `maqueta.ts` significa una segunda envoltura naciendo, que es justo lo
  // que había antes con cinco redacciones distintas del mismo correo.
  const MARCAS = [
    "<!doctype",
    "<body",
    "<table",
    "cellpadding",
    "cellspacing",
    "bgcolor=",
    'style="',
  ]

  it.each(caminoDeEnvio.map(corta))("%s no escribe HTML de correo a mano", (rel) => {
    const codigo = codigoDe(join(process.cwd(), rel)).toLowerCase()
    for (const marca of MARCAS) {
      expect(
        codigo.includes(marca),
        `${rel}: ${marca} — la envoltura del correo es \`lib/email/maqueta.ts\` y no hay otra`,
      ).toBe(false)
    }
  })
})

describe("el correo se abre en Gmail, no dentro de la app", () => {
  /**
   * Todo lo que un cliente de correo no sabe resolver.
   *
   * NO ES PEDANTERÍA DE ESTILO: el fallo es silencioso y total. Cuando el motor de Word (Outlook de
   * escritorio, el que más usan las clínicas) o Gmail no entienden el VALOR de una declaración, no
   * caen a un color por defecto: descartan la declaración entera. Un `color: var(--tv-mint-600)`
   * deja el texto del color que herede, que en un correo que además pinta fondos explícitos termina
   * siendo tinta oscura sobre verde oscuro.
   *
   * `globals.css` no viaja con el correo, así que ninguna variable tiene dónde resolverse. Y los
   * formatos nuevos —`oklch()`, `color-mix()`, `light-dark()`, el hex con alfa— llegaron a los
   * navegadores hace poco y a los clientes de correo no llegaron.
   */
  const NO_LLEGAN: [RegExp, string][] = [
    [/var\(--/, "una variable CSS — `globals.css` no viaja adentro del correo"],
    [/\b(?:oklch|oklab|lch|lab|hwb)\(/i, "un espacio de color que el cliente no conoce"],
    [/\bcolor-mix\(/i, "`color-mix()`"],
    [/\blight-dark\(/i, "`light-dark()` — el correo se declara claro y pinta sus fondos"],
    [/(?:^|[^-\w])color\(/i, "la función `color()`"],
    [/\b(?:rgb|hsl)a?\(/i, "`rgb()`/`hsl()` — en el correo los colores van en hex"],
    [/#[0-9a-f]{8}\b/i, "un hex de 8 dígitos: el alfa hace que Outlook tire la declaración"],
  ]

  it.each([MAQUETA, ...caminoDeEnvio].map(corta))("%s sólo usa colores que llegan", (rel) => {
    const codigo = codigoDe(join(process.cwd(), rel))
    for (const [patron, porque] of NO_LLEGAN) {
      expect(patron.test(codigo), `${rel}: ${porque}`).toBe(false)
    }
  })

  // ── La paleta, copiada a mano y comprobada acá ──────────────────────────────────────────────
  //
  // `maqueta.ts` declara los colores como literales y anota al lado de cuál token de `globals.css`
  // los sacó, porque no hay forma de compartir un token entre la app y un cliente de correo ajeno.
  // Esa copia a mano es una deuda que se paga sola el día que alguien mueva el verde de marca en la
  // app: la app cambia, el correo no, y nadie lo ve hasta que se comparan dos pantallas.
  //
  // Esto es lo que convierte «acá hay que venir a mano» en algo que avisa cuando no se vino.
  const DECLARADO = /const\s+\w+\s*=\s*"(#[0-9a-f]{3,6})"\s*\/\*\s*(--[\w-]+)/gi

  /**
   * Los tokens de `globals.css`, en su definición CLARA.
   *
   * Se corta antes del bloque `.dark`: el correo declara `color-scheme: light` y pinta fondos
   * explícitos justo para NO seguir el tema del cliente, así que el valor que le corresponde es
   * siempre el del `:root` claro. Sin el corte, `--text-2` traería el gris del modo oscuro.
   */
  function tokensClaros(): Record<string, string> {
    const css = fuente(GLOBALS)
    const claro = css.slice(css.indexOf(":root {"), css.indexOf(".dark,"))
    const out: Record<string, string> = {}
    for (const m of claro.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
      if (!(m[1] in out)) out[m[1]] = m[2].toLowerCase()
    }
    return out
  }

  it("los colores del correo son los mismos que los de la app", () => {
    const tokens = tokensClaros()
    const declarados = [...fuente(MAQUETA).matchAll(DECLARADO)]

    // Si el parseo no encuentra nada, alguien reescribió las constantes sin dejar dicho de dónde
    // salen — y ahí la copia deja de ser verificable, que es peor que estar desactualizada.
    const porque = "maqueta.ts ya no dice de qué token salió cada color"
    expect(declarados.length, porque).toBeGreaterThan(0)

    for (const [, hex, token] of declarados) {
      expect(tokens[token], `${token} no está en la paleta clara de globals.css`).toBeDefined()
      expect(hex.toLowerCase(), `el correo pinta ${token} con un valor que la app ya no usa`).toBe(
        tokens[token],
      )
    }
  })
})

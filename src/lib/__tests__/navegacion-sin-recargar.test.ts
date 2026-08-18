// Dentro de la app se navega con `<Link>`. Un `<a href>` a una ruta interna recarga el documento.
//
// EL BUG, VISTO EN VIVO EN LA REUNIÓN DEL 17-AGO. El cliente empezaba a grabar una consulta, tocaba
// cualquier ítem del menú lateral, y el navegador le preguntaba si quería salir del sitio:
//
//     Luciano: "me funcionó una vez y después pasó esto… me pide como change, ok, pues leave.
//               Y vamos a ver, y el man ya no sale"
//     Felipe:  "y se borra, se borra, o sea, no está siendo persistente"
//
// Ese "leave" es el diálogo de `beforeunload`, y sólo aparece si el documento se está descargando.
// O sea que el menú no estaba navegando: estaba recargando la página entera.
//
// POR QUÉ ESO MATA LA GRABACIÓN. Está escrito en `consulta-viva/sesion.ts`: «`MediaRecorder` y los
// blobs mueren con el documento, y `getUserMedia` no se puede re-adquirir sin un gesto del usuario».
// La sesión vive en el módulo y el notch se pinta desde `dashboard/layout.tsx`; las dos cosas
// sobreviven una navegación de cliente y ninguna sobrevive una recarga.
//
// Y ES UN ARREGLO QUE YA ESTABA A MEDIAS. El cerrojo de sesión única de `sesion.ts` existe porque
// «antes navegar cortaba la grabación, así que no podía haber dos»: alguien ya había hecho la sesión
// persistente. Nunca llegó a funcionar porque el sidebar recargaba. Este test es lo que impide que
// se vuelva a caer, porque la regresión no rompe nada visible — la app sigue navegando, sólo que
// lenta y perdiendo la grabación.
//
// POR QUÉ UN TEST DE FUENTE. Ningún test de componente puede fallar por esto: un `<a href>` renderiza
// perfecto y navega. Lo que cambia es cómo, y eso sólo se ve leyendo el código. Es la misma clase de
// regla que el contraste de los tokens, el anillo de foco y las etiquetas de los selects.
//
// LO QUE SÍ PUEDE SER UN <a> CRUDO, y por eso la regla mira los atributos y no el tag:
//   - `target="_blank"` — abre otra pestaña, no descarga la actual. La factura para imprimir es así.
//   - `download`        — la exportación de datos de la clínica.
//   - `#ancla`, `http`, `mailto:`, `tel:` — no son rutas de la app.
//
// ── Y LA SEGUNDA CARA DEL MISMO BUG, encontrada el 18-ago ────────────────────────────────────────
//
// Arreglado el menú, el cliente volvió a ver el diálogo de «¿salir del sitio?» y lo describió como
// INCONSISTENTE. Tenía razón: quedaba otro camino. Un `<form method="get">` que se envía solo hace
// una navegación NATIVA — el navegador descarga el documento igual que con un ancla cruda.
//
// Estaba en cuatro pantallas, y una era `/dashboard/consultas`: LA DEL MODO FANTASMA. Grabar, buscar
// una consulta anterior para comparar, y perder la grabación. De ahí que se viera intermitente: el
// menú ya no lo provocaba, pero el buscador de la propia pantalla sí.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

/**
 * Qué se revisa: la app autenticada.
 *
 * LA LANDING QUEDA FUERA A PROPÓSITO. Es otra superficie: no hay grabación que perder, sus enlaces
 * son anclas a secciones de la misma página, y su animación de entrada depende de que el documento
 * se cargue de nuevo. Ahí el `<a>` es correcto. Si algún día se le pasa a `<Link>`, será por
 * velocidad y no por esto.
 */
const FUERA_DE_ALCANCE = ["components/landing/", "components/subpages/"]

/** El tag de apertura completo, con sus atributos. `[^>]*` alcanza porque ningún atributo lleva `>`. */
const APERTURA_DE_ANCLA = /<a\s[^>]*>/g

/** Un `<form>` con sus atributos, para distinguir el que navega del que sólo llama a una función. */
const APERTURA_DE_FORM = /<form\s[^>]*>/g

/** El valor del href, en sus dos formas: `href="…"` y `href={…}`. */
const HREF_LITERAL = /href="([^"]*)"/
const HREF_EXPRESION = /href=\{/

/**
 * Quita los comentarios antes de buscar.
 *
 * HACE FALTA, y lo destapó este mismo archivo: los comentarios que explican el bug citan
 * `<form method="get">` y `<a href>` como ejemplos de lo que NO hay que hacer, y el escáner los
 * leía como código. O sea que documentar la regla la rompía.
 *
 * El chequeo de anclas se venía salvando de casualidad —las menciones en prosa no llevan `href=`—,
 * así que esto también le cierra el agujero a él.
 *
 * `[^:]` antes de las dos barras protege a `https://`: sin eso, media línea de cualquier URL
 * desaparecería y con ella los atributos que vienen después.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function fuentes(): { ruta: string; contenido: string }[] {
  return readdirSync(RAIZ, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({
      ruta: f.replace(/\\/g, "/"),
      contenido: sinComentarios(readFileSync(join(RAIZ, f), "utf8")),
    }))
    .filter((a) => !FUERA_DE_ALCANCE.some((p) => a.ruta.startsWith(p)))
}

const ARCHIVOS = fuentes()

/**
 * ¿Este ancla descarga el documento actual?
 *
 * Ante la duda dice que SÍ. Un href por expresión —`href={c.url}`— no se puede resolver leyendo el
 * fuente, así que se lo trata como interno salvo que el propio ancla declare que abre en otra
 * pestaña o que descarga. Errar hacia el falso positivo cuesta un `target` explícito; errar hacia el
 * otro lado devuelve el bug.
 */
function recargaLaPagina(tag: string): boolean {
  if (/target="_blank"/.test(tag)) return false
  if (/\bdownload\b/.test(tag)) return false

  const literal = tag.match(HREF_LITERAL)
  if (literal) {
    const href = literal[1]
    // Ancla a una sección, protocolo externo, o enlace a otro sitio: no es navegación de la app.
    return !/^(#|https?:|mailto:|tel:)/.test(href)
  }

  return HREF_EXPRESION.test(tag)
}

/**
 * ¿Este formulario navega de forma NATIVA al enviarse?
 *
 * Un `<form>` sin `onSubmit` que declare `method="get"` o un `action` de ruta hace que el navegador
 * cargue el documento de nuevo. Con `onSubmit` se asume que alguien llama a `preventDefault` — es
 * aproximado, pero del lado seguro: lo que no se puede verificar leyendo el fuente es qué hace esa
 * función, y exigirle además el `action` sería pedirle a cada formulario que se justifique.
 *
 * Los `action={…}` por expresión son acciones de servidor de React, no navegación del navegador.
 */
function navegaAlEnviarse(tag: string): boolean {
  if (/onSubmit=/.test(tag)) return false
  if (/method="get"/i.test(tag)) return true
  return /action="\/[^"]*"/.test(tag)
}

describe("dentro de la app se navega con <Link>, no con <a href>", () => {
  // Sin esta guarda, un cambio de formato que rompa el regex volvería el test verde y vacío — que es
  // el mismo fallo silencioso que viene a evitar.
  it("hay anclas que revisar (si no, el test no mide nada)", () => {
    const total = ARCHIVOS.reduce((n, a) => n + (a.contenido.match(APERTURA_DE_ANCLA) ?? []).length, 0)
    expect(total).toBeGreaterThan(3)
  })

  it("ningún <a> interno: recargan el documento y matan la grabación en curso", () => {
    const culpables = ARCHIVOS.flatMap((a) =>
      (a.contenido.match(APERTURA_DE_ANCLA) ?? [])
        .filter(recargaLaPagina)
        .map((tag) => `${a.ruta} — ${tag.replace(/\s+/g, " ").slice(0, 90)}`)
    )

    expect(
      culpables,
      "Un <a href> a una ruta interna NO navega por el cliente: descarga el documento de nuevo, y " +
        "con él mueren el MediaRecorder y la sesión de `consulta-viva`. Usá `<Link href={…}>` de " +
        "`next/link`. Si de verdad tiene que salir de la app, declaralo con `target=\"_blank\"` o " +
        "`download` y esta regla lo deja pasar.",
    ).toEqual([])
  })

  // LA SEGUNDA CARA DEL BUG. Es la que hizo que el cliente lo viera "inconsistente" después del
  // primer arreglo: el menú ya no recargaba, pero el buscador de la pantalla de consultas sí.
  it("ningún <form> que navegue solo: recarga el documento igual que un <a href>", () => {
    const culpables = ARCHIVOS.flatMap((a) =>
      (a.contenido.match(APERTURA_DE_FORM) ?? [])
        .filter(navegaAlEnviarse)
        .map((tag) => `${a.ruta} — ${tag.replace(/\s+/g, " ").slice(0, 90)}`)
    )

    expect(
      culpables,
      "Un <form method=\"get\"> se envía de forma NATIVA: el navegador descarga el documento de " +
        "nuevo y se lleva puesta la grabación en curso. Usá `<FormularioDeFiltros>` " +
        "(`components/ui/formulario-de-filtros.tsx`), que conserva el `action` para quien no tenga " +
        "JavaScript y navega por el router para todos los demás.",
    ).toEqual([])
  })

  // La barra lateral es donde estaba el bug y es por donde el vet navega todo el día. Que el chequeo
  // de arriba la cubra hoy no garantiza que la siga cubriendo: alcanza con que alguien mueva estos
  // ítems a otro archivo. Esto lo ancla por nombre.
  it("los tres archivos del menú lateral navegan con <Link>", () => {
    for (const archivo of ["components/nav-main.tsx", "components/nav-secondary.tsx", "components/app-sidebar.tsx"]) {
      const fuente = ARCHIVOS.find((a) => a.ruta === archivo)
      expect(fuente, `${archivo} dejó de existir o cambió de sitio`).toBeDefined()
      expect(fuente!.contenido, `${archivo} tiene que importar next/link`).toMatch(
        /import Link from "next\/link"/,
      )
      expect(
        (fuente!.contenido.match(/render=\{<Link href=/g) ?? []).length,
        `${archivo} tiene que pasar los ítems del menú por <Link>`,
      ).toBeGreaterThan(0)
    }
  })
})

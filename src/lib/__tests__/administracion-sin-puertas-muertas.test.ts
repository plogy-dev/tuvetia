/**
 * El panel de administración no puede prometer una pantalla que no existe.
 *
 * ── EL ESPEJO DEL CERROJO DE VENTAS ───────────────────────────────────────────────────────────
 *
 * `ventas-sin-pantallas-huerfanas.test.ts` cuida el problema contrario: una pantalla construida sin
 * puerta. Éste cuida la puerta sin pantalla, que es el riesgo propio de un índice.
 *
 * Y no es hipotético. El panel nació el 25-ago siendo casi todo enlaces a funciones que ya vivían en
 * otro lado —configuración, titulares, perfil fiscal, suscripción—, así que su corrección depende
 * ENTERAMENTE de que esos destinos sigan donde dice. El día que alguien mueva `/dashboard/plan` o
 * renombre `owners`, el índice va a seguir compilando y mostrando seis tarjetas: una de ellas lleva
 * a un 404 y nadie se entera hasta que un cliente la pulsa.
 *
 * ── LO QUE COMPRUEBA ──────────────────────────────────────────────────────────────────────────
 *
 * Que cada `href` del índice corresponde a una carpeta con `page.tsx` bajo `src/app`. La query
 * (`?tab=equipo`) se recorta: no es parte de la ruta.
 *
 * NO comprueba que la pestaña exista —eso es contenido de la pantalla, no ruteo—; para eso está el
 * caso de abajo, que verifica que las pestañas que el índice nombra están declaradas en la pantalla
 * de configuración.
 */
import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const INDICE = readFileSync(
  join("src", "app", "dashboard", "administracion", "page.tsx"),
  "utf8",
)
const CLINICA = readFileSync(
  join("src", "app", "dashboard", "administracion", "clinica", "page.tsx"),
  "utf8",
)

/**
 * Los `href` del índice.
 *
 * Se leen del literal `href: "..."`, no de todas las comillas del archivo: los comentarios de este
 * repo nombran rutas en prosa, y ésa es la cuarta vez que un test que escanea fuente se muerde la
 * cola leyendo su propia documentación.
 */
function hrefsDelIndice(): string[] {
  return [...INDICE.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1])
}

describe("el panel de administración", () => {
  it("tiene entradas", () => {
    // Si el regex deja de encontrar nada —porque cambió la forma del literal— este test pasaría
    // vacío y el cerrojo sería decorativo.
    expect(hrefsDelIndice().length).toBeGreaterThanOrEqual(5)
  })

  it("no ofrece ninguna pantalla que no exista", () => {
    for (const href of hrefsDelIndice()) {
      const ruta = href.split("?")[0]
      expect(ruta.startsWith("/dashboard/")).toBe(true)
      const carpeta = join("src", "app", ...ruta.split("/").filter(Boolean))
      expect(existsSync(join(carpeta, "page.tsx")), `${href} no tiene pantalla`).toBe(true)
    }
  })

  it("las pestañas que nombra el índice están declaradas en la pantalla de configuración", () => {
    const declaradas = new Set(
      [...CLINICA.matchAll(/\{\s*id:\s*"([a-z]+)",\s*label:/g)].map((m) => m[1]),
    )
    expect(declaradas.size).toBeGreaterThanOrEqual(3)

    for (const href of hrefsDelIndice()) {
      const [, query] = href.split("?")
      if (!query) continue
      const tab = new URLSearchParams(query).get("tab")
      if (!tab) continue
      expect(declaradas.has(tab), `la pestaña "${tab}" no existe`).toBe(true)
    }
  })

  it("la ruta vieja de configuración sigue respondiendo y reenvía la query", () => {
    // El callback de WhatsApp vuelve del proveedor a `/dashboard/settings?...`. Borrar esa ruta —o
    // dejarla redirigiendo sin la query— deja al vet sin la confirmación de que quedó conectado.
    const vieja = join("src", "app", "dashboard", "settings", "page.tsx")
    expect(existsSync(vieja)).toBe(true)
    const fuente = readFileSync(vieja, "utf8")
    expect(fuente).toContain("redirect(")
    expect(fuente).toContain("/dashboard/administracion/clinica")
    expect(fuente).toContain("searchParams")
  })
})

// ── LA OTRA PUERTA MUERTA: LA QUE ABRE EN EL LUGAR EQUIVOCADO ───────────────────────────────────
//
// Los casos de arriba cuidan que el destino EXISTA. Éste cuida algo que se le parece y duele igual:
// un enlace que lleva a una pantalla real y correcta, pero deja al vet lejos de lo que le
// prometieron. David, 27-ago, sobre el «Encender» de los avisos por WhatsApp de la agenda: «me
// lleva a la tab clínica y eso no sirve». El enlace apuntaba a la pantalla pelada, así que abría en
// la pestaña por defecto —«Clínica»—, donde no hay un solo interruptor de avisos.
//
// Es el mismo defecto que `conectar-donde-hace-falta.test.ts` cuida para WhatsApp y el calendario,
// visto desde el otro lado: allá se mide que la pantalla no MANDE de viaje; acá, que cuando el
// viaje es correcto —el interruptor es de administrador y no puede vivir en la agenda— por lo menos
// aterrice. Y no se nota nunca solo: compila, pinta un enlace, y abre una pantalla que existe.
const PANEL_DE_AGENDA = readFileSync(
  join("src", "components", "calendar", "panel-de-agenda.tsx"),
  "utf8",
)

/**
 * El `href` con el que la agenda manda a encender los avisos.
 *
 * Se lee del literal `href="..."` y no de cualquier aparición de la ruta: los comentarios de ese
 * archivo CITAN la URL vieja como ejemplo de lo que no va, y un test que busque la cadena suelta se
 * muerde la cola leyendo su propia documentación.
 */
function enlaceAAvisos(): string {
  const hrefs = [...PANEL_DE_AGENDA.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
  const clinica = hrefs.filter((h) => h.startsWith("/dashboard/administracion/clinica"))
  expect(clinica, "el panel de la agenda ya no enlaza a Configuración").toHaveLength(1)
  return clinica[0]
}

/** El cuerpo JSX de la pestaña `agenda`, que es donde tiene que estar el ancla. */
function pestanaAgenda(): string {
  // `lastIndexOf`: la condición aparece antes, en el `Promise.all` que decide qué consultar. La
  // última es la del render, que es la que se está afirmando.
  const inicio = CLINICA.lastIndexOf('activa === "agenda"')
  const fin = CLINICA.indexOf('activa === "cuenta"', inicio)
  return CLINICA.slice(inicio, fin === -1 ? undefined : fin)
}

describe("el enlace de la agenda para encender los avisos", () => {
  it("abre la pestaña donde vive el interruptor, no la de por defecto", () => {
    const tab = new URLSearchParams(enlaceAAvisos().split("?")[1]?.split("#")[0] ?? "").get("tab")
    expect(tab, "sin ?tab= la pantalla abre en «Clínica»").toBe("agenda")
  })

  it("apunta al ajuste y no al tope de la pestaña", () => {
    // La otra mitad del pedido («al lugar específico»): los horarios de atención van primero y son
    // largos, así que aterrizar arriba de la pestaña deja el interruptor a media pantalla de
    // scroll. Llegar y tener que buscar sigue sin ser intuitivo.
    expect(enlaceAAvisos()).toContain("#")
  })

  it("el ancla que nombra existe, y está en la tarjeta de los avisos", () => {
    // Si alguien renombra el `id` —o mueve la tarjeta a otra pestaña— el enlace sigue compilando y
    // sigue abriendo la pantalla: simplemente deja de saltar, en silencio.
    const ancla = enlaceAAvisos().split("#")[1]
    const agenda = pestanaAgenda()
    expect(agenda).toContain(`id="${ancla}"`)
    expect(agenda).toContain("RecordatorioCitasSettings")
    expect(agenda).toContain("ConfirmacionCitasSettings")
  })

  // NO ESTÁN ACÁ dos pruebas que sí existieron: la del `LlevarAlAncla` que repone el salto tras el
  // <Suspense>, y la del rótulo «Encender en Configuración». Describían una implementación local
  // que perdió contra la de `origin/master` al consolidar el 30-ago; `master` resuelve el aterrizaje
  // por otro camino. Si vuelve a hacer falta, el original está en el stash de esa consolidación.
})

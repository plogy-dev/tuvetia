// La pestaña del navegador tiene que decir en qué pantalla está el vet.
//
// ── DE DÓNDE SALE ESTE CERROJO ────────────────────────────────────────────────────────────────
//
// La auditoría E2E del 16-ago encontró 27 de 32 pantallas sin título: todas decían "Tuvetia", que es
// el `title` del layout raíz. Con seis pestañas abiertas —la agenda, dos consultas, la caja— no había
// forma de volver a la que uno quería sin ir probando de a una. Se corrigió pantalla por pantalla, y
// ése es exactamente el tipo de arreglo que se deshace solo: la próxima pantalla que alguien cree va a
// heredar "Tuvetia" sin que nadie lo note, porque no rompe nada.
//
// ── LO QUE COMPRUEBA ──────────────────────────────────────────────────────────────────────────
//
// Que cada `page.tsx` de `src/app` declare su título, o que lo declare el `layout.tsx` de su misma
// carpeta, o que esté en la lista de exentas de abajo. Y —esto importa tanto como lo anterior— que
// cada exención SIGA SIENDO CIERTA: no alcanza con nombrar el archivo, el test vuelve a verificar el
// motivo. Una lista de perdones que nadie revisa es peor que no tener el test.
//
// NO comprueba que el título describa bien la pantalla; eso no lo sabe un test. Sí comprueba que
// todos usen el mismo separador, que es lo que hace que la fila de pestañas se lea como una sola cosa.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const APP = join(process.cwd(), "src", "app")

/**
 * Las pantallas que a propósito NO declaran título, con el motivo. Cada una la vuelve a comprobar
 * el caso «las exenciones siguen siendo ciertas»: si el motivo deja de valer, el test cae acá y no
 * en la pantalla, que es donde se puede leer por qué se decidió así.
 */
const EXENTAS = new Map<string, string>([
  [
    "(marketing)/page.tsx",
    // Su layout ya declara título, descripción, Open Graph y Twitter, y ese título ES el de la
    // landing: el grupo (marketing) existe para servirla. Declarar uno acá lo pisaría con una copia
    // que el día que alguien retoque la del layout se queda vieja — y esta es la única pantalla del
    // repo donde el título es SEO de verdad, no comodidad de pestaña.
    "el layout de (marketing) ya la titula",
  ],
  [
    "dashboard/page.tsx",
    // `redirect()` corta antes de que se pinte nada: la respuesta es un 307 sin `<head>`. El título
    // que se ve es el de `/dashboard/tablero`, que es donde termina el vet.
    "es sólo un redirect",
  ],
  [
    "dashboard/settings/page.tsx",
    // Ídem: sobrevive para no romper los enlaces viejos y el callback de WhatsApp, y reenvía a
    // `/dashboard/administracion/clinica`.
    "es sólo un redirect",
  ],
  [
    "dashboard/facturacion/@modal/(.)nueva/page.tsx",
    // OJO CON LA TENTACIÓN DE PONERLE UNO "porque total Next ignora los slots paralelos": no los
    // ignora. `next/dist/lib/metadata/resolve-metadata.js` recorre TODOS los slots al juntar la
    // metadata (`for (const key in parallelRoutes)`), así que un título acá entraría en la mezcla
    // junto con el del libro de ventas y el orden de los segmentos decidiría cuál gana.
    // Por eso no lleva: el modal se abre ENCIMA del libro, que sigue ahí atrás; la pestaña tiene que
    // seguir diciendo "Ventas" mientras se carga la factura nueva.
    "es un modal sobre el libro de ventas: la pestaña sigue siendo la del libro",
  ],
])

const DECLARA = /export\s+(const\s+metadata\b|(async\s+)?function\s+generateMetadata\b)/

/** El primer título literal de un `export const metadata`. Vacío si lo arma con una constante. */
function tituloDe(fuente: string): string | null {
  const m = fuente.match(/export\s+const\s+metadata[^=]*=\s*\{[\s\S]*?title:\s*"([^"]+)"/)
  return m ? m[1] : null
}

function pantallas(): { ruta: string; fuente: string; carpeta: string }[] {
  return readdirSync(APP, { recursive: true, encoding: "utf8" })
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => f.endsWith("page.tsx"))
    .map((f) => ({
      ruta: f,
      fuente: readFileSync(join(APP, f), "utf8"),
      carpeta: join(APP, f, ".."),
    }))
}

const PANTALLAS = pantallas()

/** El `layout.tsx` de la misma carpeta, que es donde va el título de una pantalla cliente. */
function layoutHermano(carpeta: string): string | null {
  const ruta = join(carpeta, "layout.tsx")
  return existsSync(ruta) ? readFileSync(ruta, "utf8") : null
}

const seTitula = (p: (typeof PANTALLAS)[number]) =>
  DECLARA.test(p.fuente) || DECLARA.test(layoutHermano(p.carpeta) ?? "")

describe("ninguna pantalla deja la pestaña diciendo sólo «Tuvetia»", () => {
  it("hay pantallas que revisar", () => {
    // Si el recorrido deja de encontrar archivos —porque cambió `src/app` de lugar o el nombre del
    // convenio— los casos de abajo pasarían vacíos y el cerrojo sería decorativo.
    expect(PANTALLAS.length).toBeGreaterThanOrEqual(50)
  })

  it("todas declaran su título, ellas o el layout de su carpeta", () => {
    const mudas = PANTALLAS.filter((p) => !seTitula(p) && !EXENTAS.has(p.ruta)).map((p) => p.ruta)
    expect(mudas, `sin título de pestaña:\n${mudas.join("\n")}`).toEqual([])
  })

  it("las exenciones siguen siendo ciertas", () => {
    for (const ruta of EXENTAS.keys()) {
      expect(existsSync(join(APP, ruta)), `${ruta} ya no existe: sobra en la lista`).toBe(true)
    }

    // La landing depende del layout de su grupo. Si alguien le saca el título ahí, la home pública
    // se queda sin el suyo y no hay nada más que lo cubra.
    expect(DECLARA.test(readFileSync(join(APP, "(marketing)", "layout.tsx"), "utf8"))).toBe(true)

    // Las dos puertas sólo se perdonan mientras sigan siendo puertas. Si alguna vuelve a pintar una
    // pantalla, necesita título propio.
    for (const ruta of ["dashboard/page.tsx", "dashboard/settings/page.tsx"]) {
      expect(readFileSync(join(APP, ruta), "utf8"), `${ruta} ya no es un redirect`).toContain(
        "redirect(",
      )
    }

    // Y el modal, mientras siga viviendo dentro de un slot paralelo. El día que se saque de `@modal`
    // deja de abrirse encima del libro de ventas —pasa a ser una pantalla común, con su propia
    // pestaña— y ahí sí necesita título propio.
    const enSlot = [...EXENTAS.keys()].filter((r) => r.split("/").some((s) => s.startsWith("@")))
    expect(enSlot).toEqual(["dashboard/facturacion/@modal/(.)nueva/page.tsx"])
  })

  it("ninguna pantalla cliente intenta exportar el título ella misma", () => {
    // No es una preferencia de estilo: `metadata` sólo se admite en Server Components, así que un
    // `"use client"` con `export const metadata` no arranca. El error de compilación no dice dónde
    // ponerlo, y la salida correcta —un layout de servidor en la misma carpeta que devuelve
    // `children` tal cual— no se le ocurre a nadie con el mensaje de Next en la mano.
    const clientes = PANTALLAS.filter((p) => /^\s*"use client"/.test(p.fuente))
    expect(clientes.length).toBeGreaterThanOrEqual(3)

    for (const p of clientes) {
      expect(DECLARA.test(p.fuente), `${p.ruta} es cliente y no puede exportar metadata`).toBe(false)

      // A una exenta no se le exige layout hermano, pero tampoco se le prohíbe: `(marketing)` se
      // perdona JUSTAMENTE porque su layout la titula, así que exigir lo contrario acá haría fallar
      // el test el día que esa pantalla pase a ser cliente — por cumplir su propia exención.
      if (EXENTAS.has(p.ruta)) continue

      expect(
        DECLARA.test(layoutHermano(p.carpeta) ?? ""),
        `${p.ruta} es cliente: su título va en un layout.tsx hermano`,
      ).toBe(true)
    }
  })

  it("todos los títulos usan el mismo separador", () => {
    // El punto medio con espacios, no un guion ni dos puntos. Se comprueba sólo el separador y no
    // que terminen en "Tuvetia": las del panel de plataforma van al revés ("Admin · Clínicas"),
    // porque ahí lo que ubica es la sección, no el producto.
    // Páginas y layouts, porque hay títulos que viven en el layout. Menos el layout raíz: su
    // "Tuvetia" pelado es el respaldo del que se sale, no un título de pantalla.
    const titulos = readdirSync(APP, { recursive: true, encoding: "utf8" })
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => (f.endsWith("page.tsx") || f.endsWith("layout.tsx")) && f !== "layout.tsx")
      .map((f) => tituloDe(readFileSync(join(APP, f), "utf8")))
      .filter((t): t is string => t !== null)

    expect(titulos.length).toBeGreaterThanOrEqual(40)
    const raros = titulos.filter((t) => !t.includes(" · "))
    expect(raros, `títulos con otro separador: ${raros.join(", ")}`).toEqual([])
  })
})

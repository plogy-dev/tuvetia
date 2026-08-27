/**
 * Una pantalla que no puede resolver algo no puede mandar al vet a otra que tampoco.
 *
 * ── EL BUCLE, HALLADO EN LA AUDITORÍA DEL 26-AGO ────────────────────────────────────────────────
 *
 * Comunicaciones → Correo decía «conectá tu cuenta, es un clic» y llevaba a Integraciones.
 * Integraciones contestaba «la conexión de correo no está disponible en este servidor todavía.
 * Falta configurar Composio (COMPOSIO_API_KEY y el auth config del proveedor)». El vet iba, volvía
 * y quedaba donde empezó — sin nada que hacer y con la sospecha de haber hecho algo mal.
 *
 * Lo que lo hacía evitable: el dato YA ESTABA en la pantalla de Correo. `composioConfigurado()` se
 * calculaba ahí arriba y sólo se usaba para decidir si consultar la conexión, nunca para hablar.
 *
 * ── LO QUE SE VIGILA, Y POR QUÉ NO ES EL TEXTO ──────────────────────────────────────────────────
 *
 * No se fija la redacción —eso cambia— sino las dos reglas que hacían falta:
 *
 *   1. Que «no está habilitado en el servidor» y «te falta conectar tu cuenta» sean ramas
 *      DISTINTAS. Son situaciones distintas: una tiene acción del vet y la otra no.
 *   2. Que ninguna pantalla del vet nombre una variable de entorno. Un veterinario no puede hacer
 *      nada con `COMPOSIO_API_KEY`, y leerlo le sugiere que sí debería.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { CK_TABS, PILL_TABS } from "@/lib/landing/data"

const RAIZ = join(process.cwd(), "src")

const leer = (...ruta: string[]) => readFileSync(join(RAIZ, ...ruta), "utf8")

/** El archivo sin comentarios: si no, estos tests se aprueban leyendo su propia explicación. */
const leerSinComentarios = (...ruta: string[]) =>
  leer(...ruta)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("el correo no manda a Integraciones cuando Integraciones no puede", () => {
  const pagina = leerSinComentarios("app", "dashboard", "comunicaciones", "correo", "page.tsx")

  it("distingue «no está habilitado» de «no conectaste tu cuenta»", () => {
    // La rama de servidor tiene que decidirse ANTES que la de conexión: si no, la de conexión
    // atrapa los dos casos y vuelve el bucle.
    const iDisponible = pagina.indexOf("if (!disponible)")
    const iConectado = pagina.indexOf("if (!conexion.conectado)")
    expect(iDisponible).toBeGreaterThan(-1)
    expect(iConectado).toBeGreaterThan(-1)
    expect(iDisponible).toBeLessThan(iConectado)
  })

  it("y en esa rama NO ofrece el botón que cierra el círculo", () => {
    const iDisponible = pagina.indexOf("if (!disponible)")
    const iConectado = pagina.indexOf("if (!conexion.conectado)")
    const rama = pagina.slice(iDisponible, iConectado)
    expect(rama).not.toContain("/dashboard/conexiones")
    // Ofrece una salida REAL: WhatsApp no depende de Composio y sí funciona.
    expect(rama).toContain("/dashboard/comunicaciones")
  })
})

describe("ninguna pantalla del vet nombra una variable de entorno", () => {
  // `COMPOSIO_API_KEY` se le mostraba en DOS pantallas de configuración. El operador necesita ese
  // dato; el veterinario no puede hacer nada con él, y verlo le sugiere que sí debería.
  //
  // La regla se aplica al dashboard —lo que ve un vet— y NO a `app/admin`, que es la consola de la
  // plataforma: ahí nombrar una variable es exactamente lo correcto.
  const fuentes = (dir: string) =>
    readdirSync(join(RAIZ, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => `${dir}/${f.replace(/\\/g, "/")}`)

  it("no hay un <code> con nombre de variable en el dashboard ni en los componentes", () => {
    const culpables: string[] = []
    for (const ruta of [...fuentes("app/dashboard"), ...fuentes("components")]) {
      const texto = leer(...ruta.split("/"))
      // Mayúsculas con guiones bajos dentro de un <code>: la forma de una env var. Seis caracteres
      // de mínimo para no atrapar siglas cortas legítimas (`IVA`, `NIT`, `SOAP`).
      const hallazgos = texto.match(/<code>[A-Z][A-Z0-9_]{5,}<\/code>/g)
      if (hallazgos) culpables.push(`${ruta}: ${hallazgos.join(", ")}`)
    }
    expect(culpables).toEqual([])
  })
})

describe("la landing no le anuncia a un visitante que el producto está a medias", () => {
  // ── EL HALLAZGO MÁS VISIBLE DE LA AUDITORÍA DEL 26-AGO ────────────────────────────────────────
  //
  // El demo interactivo de la home tiene once pestañas, y CUATRO —«Casos parecidos» y «Chat», en
  // las dos barras— caían a un `<div class="soon">Próximamente · placeholder en el código real`.
  // A un clic desde la portada, en la cara de cualquiera que entrara a mirar.
  //
  // Se cerró escribiendo las dos pestañas, no escondiéndolas: la función existe en el producto
  // (`CasosParecidos` busca en el historial de la propia clínica; el chat cita o se calla), así que
  // lo que faltaba era el contenido del demo, no la funcionalidad.

  const engine = readFileSync(join(RAIZ, "lib", "landing", "engine.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

  it("ninguna pestaña del demo cae en un cartel de «Próximamente»", () => {
    expect(engine).not.toContain("Próximamente")
    expect(engine).not.toContain("placeholder")
    // Y la clase que lo pintaba se fue con él: sin estilo no puede volver de casualidad.
    expect(readFileSync(join(RAIZ, "app", "landing.css"), "utf8")).not.toContain(".soon{")
  })

  it("las pestañas que existen tienen su rama, y las dos barras se cubren", () => {
    // `consulta` no entra: no pasa por `panelHTML`, lo resuelve el panel en vivo del cockpit.
    const ids = new Set([...PILL_TABS, ...CK_TABS].map(([id]) => id))
    ids.delete("consulta")
    for (const id of ids) {
      expect(engine, `la pestaña «${id}» no tiene rama en panelHTML`).toContain(`tab === "${id}"`)
    }
  })

  it("el demo llama al producto por su nombre actual", () => {
    // La tanda de renombrado del 26-ago hizo 63 reemplazos en la landing y se saltó este archivo:
    // el demo —la superficie más visible— seguía diciendo «Athos» mientras el resto decía VetGPT.
    // `Nosotros.tsx` queda fuera a propósito: ahí Athos es el bulldog del fundador, no el producto.
    expect(engine).not.toContain("Athos")
    expect(engine).toContain("VetGPT")
  })
})

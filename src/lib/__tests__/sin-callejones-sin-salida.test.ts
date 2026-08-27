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

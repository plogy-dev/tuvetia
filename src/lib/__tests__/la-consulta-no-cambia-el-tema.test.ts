/**
 * Entrar a una consulta no le cambia el tema al vet.
 *
 * EL REPORTE, 20-ago: *"al entrar a modo fantasma se pone en dark mode la sección, eso no debería
 * pasar, debe seguir en clear"*.
 *
 * ES UN CAMBIO DE DECISIÓN, NO UN ARREGLO DE DESCUIDO, y por eso el test explica el porqué en vez
 * de sólo prohibir una clase. La superficie grafito era deliberada: el sistema de diseño v2 de
 * David tenía dos contextos —CRM en blanco, consulta abierta en oscuro— para que de un vistazo se
 * supiera si había un paciente delante.
 *
 * El 19-ago se cambió la referencia de diseño al prototipo de Luciano, y ese prototipo **no tiene
 * superficie oscura por sección**: tiene un único `.dark` global que prende el usuario cuando
 * quiere. Contra esa referencia, entrar al Modo Fantasma y que la pantalla se apague sola es un
 * salto de tema que nadie pidió — y que además ignora al vet que eligió tema claro.
 *
 * ── LO QUE ESTE TEST **NO** PROHÍBE ─────────────────────────────────────────────────────────────
 *
 * Que el NOTCH siga oscuro. No es lo mismo: es un objeto flotante y chico que tiene que despegarse
 * del fondo para verse desde cualquier pantalla, y es exactamente como se ve en las capturas del
 * prototipo. Lo que se quita es que se oscurezca **la sección entera**.
 *
 * Distinguir las dos cosas es todo el valor de este archivo: un test que dijera "nadie usa
 * `.consulta`" rompería el notch, que está bien como está.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

function leer(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * Dónde SÍ puede vivir la superficie oscura: el notch y el panel que cuelga de él.
 *
 * La lista es explícita a propósito. Si mañana hace falta una tercera, que sea una decisión que
 * alguien tome agregando una línea acá —y explicando por qué— y no algo que se cuele.
 */
const PUEDEN_SER_OSCUROS = [
  "components/athos/grabacion-pastilla.tsx",
  "components/athos/panel-modo-fantasma.tsx",
]

/** Todos los `.tsx` de `src`, por ruta relativa con barras normales. */
function fuentes(): string[] {
  return readdirSync(RAIZ, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\\/g, "/"))
}

describe("ninguna sección se oscurece sola", () => {
  it("la pantalla de consulta no lleva la clase de superficie oscura", () => {
    // Las DOS ramas: la del cockpit grabando y la de la consulta ya cerrada. La primera versión de
    // este arreglo se olvidó de una y el Modo Fantasma seguía apagando la pantalla.
    const consulta = leer("app/dashboard/consultas/[id]/page.tsx")
    expect(consulta).not.toMatch(/className="consulta[\s"]/)
    expect(consulta).not.toMatch(/className=\{`consulta[\s`]/)
  })

  it("sólo el notch y su panel pueden ser oscuros", () => {
    const culpables = fuentes().filter((ruta) => {
      if (PUEDEN_SER_OSCUROS.includes(ruta)) return false
      const fuente = leer(ruta)
      return /className=["'`]consulta[\s"'`]/.test(fuente)
    })
    expect(
      culpables,
      "una sección que se oscurece sola le cambia el tema al vet sin que lo haya pedido",
    ).toEqual([])
  })

  it("el notch SÍ la conserva — no es lo mismo que una sección", () => {
    // Si este test empieza a fallar, alguien "limpió" la clase de más: el notch flota sobre
    // cualquier pantalla y sin fondo propio se pierde. Y con tema claro, `text-warn` sobre el
    // grafito del notch daba 2,8:1 — la etiqueta "Pausada" ilegible justo cuando hay que verla.
    // LA MISMA EXPRESIÓN QUE USA LA DETECCIÓN, y no una más laxa. La primera versión buscaba la
    // palabra "consulta" a secas y la encontraba en `consultaViva`, `useConsultaViva` y en la ruta
    // del import — o sea que pasaba aunque la clase ya no estuviera. Lo demostró la mutación.
    for (const ruta of PUEDEN_SER_OSCUROS) {
      expect(leer(ruta), ruta).toMatch(/className=["'`{`]*consulta[\s"'`]/)
    }
  })

  it("el tema sigue siendo global, y de quien lo elige", () => {
    // `.dark` en <html> lo prende el ThemeToggle y se guarda. Es el único cambio de tema legítimo.
    expect(readFileSync(join(RAIZ, "app", "globals.css"), "utf8")).toContain(".dark")
  })
})

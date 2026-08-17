// El indicador de foco de teclado, comprobado sobre el código fuente.
//
// POR QUÉ EXISTE. La auditoría del 2026-08-16 encontró 34 campos en 18 archivos —casi todos de
// `facturacion/`— que habían cambiado el anillo del sistema por `focus:border-brand
// focus:outline-none`: quitar el contorno nativo y sustituirlo por un tinte de borde de 1px. El
// contraste PASABA (4.58:1); lo que no pasaba era la consistencia, y el grosor queda por debajo del
// área que pide WCAG 2.2 §2.4.11. Un usuario de teclado tenía dos experiencias según el módulo.
//
// LO QUE ESTE TEST IMPIDE es que vuelva. Un archivo nuevo que copie el patrón de al lado —que es
// exactamente cómo llegaron a ser 18— rompe CI en vez de descubrirse cuando alguien navegue sin
// ratón. Es la misma técnica que `contraste-de-tokens.test.ts`: hay reglas de diseño que ningún test
// de componente puede fallar, porque no existe una assertion natural sobre "esto se ve".
//
// LA REGLA, en una frase: **quien apaga el contorno tiene que poner algo en su lugar.** El sistema lo
// hace con `outline-none` en la base más `focus-visible:ring-3` (ver `components/ui/input.tsx`), no
// con `focus:outline-none` a secas — que apaga el único indicador que había y no repone ninguno.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RAIZ = join(process.cwd(), "src")

function fuentes(): { ruta: string; contenido: string }[] {
  return readdirSync(RAIZ, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ ruta: f.replace(/\\/g, "/"), contenido: readFileSync(join(RAIZ, f), "utf8") }))
}

const ARCHIVOS = fuentes()

describe("nadie apaga el contorno de foco sin reponer un indicador", () => {
  // `focus:outline-none` apaga el contorno JUSTO cuando hace falta. La forma correcta es
  // `outline-none` en la base (siempre apagado) más `focus-visible:ring-*` (encendido al enfocar).
  it("no queda ningún `focus:outline-none` en el repo", () => {
    const culpables = ARCHIVOS.filter((a) => a.contenido.includes("focus:outline-none")).map((a) => a.ruta)

    expect(
      culpables,
      `estos archivos apagan el contorno de foco sin reponer nada. Usá el patrón del sistema:\n` +
        `  outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50\n` +
        `Ver components/ui/input.tsx.`,
    ).toEqual([])
  })

  // El sustituto que se había inventado el módulo de facturación: un borde de 1px. Se nombra aparte
  // del test de arriba para que el mensaje diga QUÉ patrón se coló, no sólo que algo falla.
  it("nadie sustituye el anillo por un tinte de borde", () => {
    const culpables = ARCHIVOS.filter((a) => a.contenido.includes("focus:border-brand")).map((a) => a.ruta)

    expect(
      culpables,
      "un borde de 1px es un indicador más débil que el anillo del sistema, y deja al módulo con " +
        "una experiencia de teclado distinta del resto de la app.",
    ).toEqual([])
  })
})

describe("un campo que apaga el contorno repone el anillo", () => {
  // LA REGLA, PRECISADA. Un `<button>` o un `<input>` SIN clases de foco no es un problema: conserva
  // el contorno nativo del navegador, que es perfectamente visible. Lo que rompe la accesibilidad es
  // apagarlo y no reponer nada — y eso sólo puede pasar donde hay `outline-none`.
  //
  // Al escribir este test lo medí mal la primera vez: buscaba archivos con `border-line bg-surface`,
  // que es el estilo de las TARJETAS, y señaló 13 archivos sin un solo elemento interactivo. La
  // regla correcta mira los campos de formulario de verdad.
  const CAMPOS = ARCHIVOS.filter(
    (a) => /<(input|select|textarea)\b/.test(a.contenido) && a.contenido.includes("outline-none"),
  )

  it("hay campos que revisar (si no, el test no está midiendo nada)", () => {
    expect(CAMPOS.length).toBeGreaterThan(5)
  })

  it("todos traen el anillo del sistema", () => {
    const sinAnillo = CAMPOS.filter((a) => !a.contenido.includes("focus-visible:ring")).map((a) => a.ruta)

    expect(
      sinAnillo,
      "estos archivos tienen campos con el contorno apagado y ningún indicador que lo reemplace.",
    ).toEqual([])
  })
})

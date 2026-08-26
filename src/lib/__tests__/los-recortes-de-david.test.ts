/**
 * Los tres recortes que David señaló el 26-ago, fijados para que no regresen.
 *
 * Los tres eran la MISMA clase de bug: contenido con tamaño intrínseco (segmentos de un input de
 * fecha/hora, dígitos de un precio) dentro de un contenedor que lo recorta o lo vuelve ilegible
 * en silencio — sin overflow visible, sin error, solo información que desaparece.
 */
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("el am/pm de los horarios", () => {
  it("los inputs de hora no vuelven a w-28 — ahí es donde «a. m.» no cabe", () => {
    // es-CO usa reloj de 12 horas: el sufijo necesita sus ~2.5em además de los dígitos, y a
    // 112px el navegador lo recorta sin avisar.
    for (const f of [
      "src/components/onboarding/welcome-wizard.tsx",
      "src/components/settings/clinic-hours-settings.tsx",
    ]) {
      const s = readFileSync(f, "utf8")
      const horas = s.match(/type="time"[\s\S]{0,300}?className="([^"]*)"/g) ?? []
      expect(horas.length, `${f} perdió sus inputs de hora`).toBeGreaterThan(0)
      for (const h of horas) {
        expect(h, `${f}: un input de hora volvió a un ancho que corta el am/pm`).not.toMatch(
          /w-(?:20|24|28)\b/,
        )
      }
    }
  })

  it("y el mínimo global para date/time existe en globals.css", () => {
    // El arreglo de fondo: cualquier formulario futuro hereda el mínimo sin saber que el bug
    // existió. Si alguien lo borra «porque no sabía para qué era», esto se lo cuenta.
    const css = readFileSync("src/app/globals.css", "utf8")
    expect(css).toMatch(/input\[type="date"\]\s*\{[^}]*min-width/)
    expect(css).toMatch(/input\[type="time"\]\s*\{[^}]*min-width/)
  })
})

describe("los precios en miles", () => {
  // David se lo pidió a dos personas y salieron DOS implementaciones el mismo día: la de este
  // repo (InputPesos) y la de Jesús (InputMonedaForm, con prefijo COP y lib/moneda compartida).
  // Ganó la de Jesús por más completa y ya aplicada a tres formularios — este cerrojo fija que el
  // catálogo la use, no cuál de las dos era.
  const FORM = readFileSync("src/components/facturacion/CatalogItemForm.tsx", "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

  it("el precio del catálogo usa el campo de moneda, no un number pelado", () => {
    // Un type="number" no admite separadores: el admin contaba ceros con el dedo en el campo
    // donde un cero de más es diez veces el precio.
    expect(FORM).toContain("<InputMonedaForm")
    expect(FORM).not.toMatch(/name="pricePesos"[\s\S]{0,80}type="number"/)
  })

  it("el campo conserva el contrato del formulario: el name viaja limpio en un hidden", () => {
    const input = readFileSync("src/components/ui/input-moneda-form.tsx", "utf8")
    expect(input).toContain('type="hidden"')
    expect(input).toContain('inputMode="numeric"')
  })
})

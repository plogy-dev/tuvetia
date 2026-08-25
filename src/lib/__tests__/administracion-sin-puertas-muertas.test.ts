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

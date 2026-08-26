/**
 * El canal de Realtime de los mensajes sin leer es POR MONTAJE, no un topic fijo.
 *
 * ── LO QUE PASÓ (26-ago, producción caída minutos después del deploy) ─────────────────────────
 *
 * `useMensajesSinLeer` abría el canal con un nombre literal («mensajes-sin-leer»). Con UN solo
 * consumidor funcionó semanas; al nacer la campanita de la cabecera, el hook quedó montado DOS
 * veces a la vez — y supabase-js devuelve el MISMO RealtimeChannel cuando el topic se repite, así
 * que el segundo montaje llamaba `.on()` sobre un canal ya suscrito, que LANZA:
 *
 *     Error: cannot add `postgres_changes` callbacks for realtime:mensajes-sin-leer after `subscribe()`
 *
 * El throw ocurre dentro del efecto, React sube al error boundary de la app, y el tablero entero
 * se convierte en «Algo se rompió de nuestro lado». Ninguna clase de test de unidad monta los dos
 * componentes juntos en un navegador, así que el cerrojo va sobre la FUENTE, como los del ancho.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const fuente = readFileSync(
  join("src", "components", "comunicaciones", "insignia-sin-leer.tsx"),
  "utf8",
)

describe("el canal de mensajes sin leer", () => {
  it("no usa un topic literal que dos montajes puedan compartir", () => {
    expect(fuente).not.toMatch(/channel\(\s*["']mensajes-sin-leer["']\s*\)/)
  })

  it("abre un canal distinto por montaje", () => {
    // El sufijo por instancia. Si esto cambia de mecanismo (useId, contador, lo que sea), lo que
    // tiene que sobrevivir es la idea: el argumento de `.channel()` no puede ser un literal fijo.
    expect(fuente).toMatch(/\.channel\(`mensajes-sin-leer-\$\{/)
  })
})

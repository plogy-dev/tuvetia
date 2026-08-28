/**
 * El efecto que dispara la inteligencia en vivo NO puede abortar en su propia limpieza.
 *
 * ── LO QUE PASÓ (encontrado el 28-ago, mirando por qué «notas en vivo» nunca escribía nada) ────
 *
 * `usar-inteligencia-viva.ts` late con `segundos` en las dependencias: cambia UNA VEZ POR SEGUNDO
 * mientras se graba (`sesion.ts`, el `setInterval` del cronómetro). Y devolvía
 * `return () => corte.abort()`.
 *
 * O sea que React corría esa limpieza en cada tick: la llamada salía, y un segundo después su
 * propio efecto la mataba. Ninguna nota en vivo llegaba nunca — el panel se quedaba en
 * «Escuchando la consulta…» para siempre.
 *
 * Y la segunda mitad, peor: el `.catch` contaba igual el disparo. Con `maxPorConsulta: 12` en
 * notas y 4 en sugerencias (`disparador.ts`), a los doce segundos útiles el techo estaba agotado
 * y el panel quedaba MUDO para el resto de la consulta, sin haber escrito una línea. Es el
 * «funciona un par de veces y después nada» de esta superficie.
 *
 * No hay función pura que probar —el defecto es la forma del efecto—, así que se prueba la forma.
 * Mismo trato que `el-ancho-no-corta.test.ts` le da a las clases de Tailwind.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const fuente = readFileSync(join("src", "lib", "consulta-viva", "usar-inteligencia-viva.ts"), "utf8")
const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

describe("la inteligencia viva", () => {
  it("no aborta desde la limpieza del efecto que late cada segundo", () => {
    // La firma exacta del defecto. Si vuelve, cada llamada se mata a sí misma un segundo después.
    expect(sinComentarios).not.toMatch(/return\s*\(\s*\)\s*=>\s*corte\.abort\(\)/)
  })

  it("sigue abortando cuando de verdad corresponde: al cambiar de consulta o al desmontar", () => {
    // El aborto no se elimina, se muda. Sin esto, una respuesta de la consulta anterior podría
    // aterrizar sobre la siguiente.
    expect(sinComentarios).toContain("corteRef")
    expect(sinComentarios).toMatch(/corteRef\.current\?\.abort\(\)/)
    // Y en un efecto cuya dependencia es la consulta, no los segundos.
    const i = sinComentarios.lastIndexOf("corteRef.current?.abort()")
    expect(sinComentarios.slice(i, i + 200)).toMatch(/\},\s*\[consultaId\]\)/)
  })

  it("un aborto no gasta el techo de la consulta", () => {
    // Si el intento no llegó al proveedor, no se cuenta. Contarlo era lo que dejaba el panel mudo.
    expect(sinComentarios).toMatch(/name\s*!==\s*"AbortError"/)
  })
})

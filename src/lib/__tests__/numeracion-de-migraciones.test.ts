// El número de una migración es su ORDEN DE APLICACIÓN, y no puede estar repetido.
//
// POR QUÉ EXISTE ESTE TEST Y NO UNA REGLA ESCRITA. Ya hay reglas: `athos-service/CLAUDE.md` y
// `docs/MIGRACIONES.md` documentan la numeración desde julio. Y aun así chocó **tres veces**:
// `0019`, `0020` y `0065`. Una convención que se incumplió tres veces no necesita repetirse mejor —
// necesita dejar de depender de que alguien se acuerde.
//
// EL CASO QUE LO MOTIVA (2026-08-17). Santiago escribió `0065_planes_y_suscripcion.sql` y yo
// `0065_tokens_cacheados.sql`, en paralelo, sin saberlo. Las dos se aplicaron y la base quedó bien,
// pero el repo perdió lo único que la numeración promete: que aplicándolas en orden se reproduce el
// estado de producción. Con dos `0065`, "aplicá la 65" es ambiguo.
//
// Y ESO IMPORTA DE VERDAD ACÁ, porque estas migraciones **se aplican a mano** contra el principal
// (el `supabase db push` está prohibido: el proyecto lleva 55 entradas del equipo original con otra
// numeración). El orden no lo garantiza ninguna herramienta — lo garantiza el nombre del archivo.
//
// LA REGLA PRÁCTICA que esto vuelve verificable: **el número se reserva al abrir el PR, no al
// escribir el archivo.** Quien vaya a crear una migración mira el último número EN MASTER, no en su
// rama.

import { readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const DIR = join(process.cwd(), "athos-service", "supabase", "migrations")

/**
 * Los choques que YA ESTÁN APLICADOS en producción.
 *
 * No se renombran, y la razón importa: renombrar un archivo que ya corrió con otro nombre haría que
 * el repo afirme algo que no ocurrió. Un `0068` que en realidad se aplicó como `0065` es exactamente
 * la clase de documento que miente — el mismo defecto que esta auditoría viene persiguiendo en
 * `CONFIGURACION-PRODUCCION.md` y en `MIGRACIONES.md`.
 *
 * Quedan acá, feos y visibles, como registro de que pasó. Lo que el test impide es el CUARTO.
 */
const CHOQUES_HISTORICOS = new Set(["0019", "0020", "0065"])

const ARCHIVOS = readdirSync(DIR).filter((f) => f.endsWith(".sql"))

describe("la numeración de las migraciones", () => {
  it("hay migraciones que revisar (si no, el test no está midiendo nada)", () => {
    expect(ARCHIVOS.length).toBeGreaterThan(50)
  })

  /**
   * `NNNN_nombre.sql`, con una letra opcional: `NNNNx_nombre.sql`.
   *
   * EL SUFIJO DE LETRA ES LA VÍA DE ESCAPE, y conviene conocerla porque resuelve justo el problema
   * que este archivo vigila. `0021b_objetos_que_nadie_crea.sql` existe porque hizo falta meter una
   * migración ENTRE la 0021 y la 0022 —la 0022 asumía objetos que ninguna creaba— cuando las dos ya
   * estaban aplicadas y renumerar habría hecho mentir al repo.
   *
   * Ordena bien por accidente afortunado del ASCII: `_` es 95 y `b` es 98, así que
   * `0021_profiles...` va antes que `0021b_objetos...`, y las dos antes que `0022_`.
   *
   * El prefijo de cuatro dígitos es lo que hace que el orden alfabético sea el orden de aplicación:
   * un `65_algo.sql` se ordenaría después de `0600_x.sql`.
   */
  it("todas siguen el formato NNNN_nombre.sql (o NNNNx_ para una intercalada)", () => {
    const malFormadas = ARCHIVOS.filter((f) => !/^\d{4}[a-z]?_[a-z0-9_]+\.sql$/.test(f))

    expect(
      malFormadas,
      "el prefijo de 4 dígitos es lo que hace que el orden alfabético sea el orden de aplicación",
    ).toEqual([])
  })

  // EL TEST QUE IMPORTA.
  //
  // La ranura incluye el sufijo: `0021` y `0021b` son posiciones DISTINTAS, no un choque. Esa es
  // toda la gracia del sufijo — intercalar sin renumerar lo que ya corrió.
  it("ningún número nuevo está repetido", () => {
    const porNumero = new Map<string, string[]>()
    for (const f of ARCHIVOS) {
      const n = /^(\d{4}[a-z]?)/.exec(f)![1]
      porNumero.set(n, [...(porNumero.get(n) ?? []), f])
    }

    const nuevos = [...porNumero.entries()]
      .filter(([n, fs]) => fs.length > 1 && !CHOQUES_HISTORICOS.has(n))
      .map(([n, fs]) => `${n}: ${fs.join(" + ")}`)

    expect(
      nuevos,
      "Dos migraciones con el mismo número hacen ambiguo el orden de aplicación, y acá se aplican " +
        "A MANO contra el principal. Renumerá la tuya al siguiente libre EN MASTER — y para la " +
        "próxima, reservá el número al abrir el PR, no al escribir el archivo.",
    ).toEqual([])
  })

  // Los históricos se comprueban de verdad, no se asumen: si alguien los renombra y arregla uno,
  // esta lista tiene que encogerse con él. Una excepción que sobrevive a su causa es deuda.
  it("los choques históricos son exactamente los tres conocidos", () => {
    const repetidos = new Set<string>()
    const vistos = new Set<string>()
    for (const f of ARCHIVOS) {
      const n = /^(\d{4}[a-z]?)/.exec(f)![1]
      if (vistos.has(n)) repetidos.add(n)
      vistos.add(n)
    }

    for (const n of CHOQUES_HISTORICOS) {
      expect(
        repetidos.has(n),
        `${n} ya no está repetido: sacalo de CHOQUES_HISTORICOS en vez de dejar la excepción viva`,
      ).toBe(true)
    }
  })
})

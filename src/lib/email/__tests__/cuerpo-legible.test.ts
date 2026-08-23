/**
 * El panel de lectura del correo: qué muestra, y cuándo avisa que no es todo.
 *
 * Existe porque el defecto que arregla no rompía nada — ni un tipo, ni un lint, ni un test. La
 * bandeja pintaba `preview` en el panel de lectura y "funcionaba": se veía un correo, con su
 * remitente y su asunto. Sólo que era el mismo texto recortado de la lista, así que abrir un correo
 * no mostraba nada nuevo. Lo reportó un veterinario, no la suite.
 */
import { describe, expect, it } from "vitest"

import { cuerpoLegible, LARGO_DEL_PREVIEW } from "../cuerpo-legible"

const largo = (n: number) => "a".repeat(n)

describe("cuerpoLegible — el cuerpo entero le gana al preview", () => {
  it("con cuerpo completo, muestra el cuerpo y NO advierte", () => {
    const r = cuerpoLegible({ cuerpo: "Hola doctor, le escribo por Luna…", preview: "Hola doctor, le e", cuerpoCompleto: true })
    expect(r.texto).toBe("Hola doctor, le escribo por Luna…")
    expect(r.completo).toBe(true)
  })

  // El defecto original, al revés: si esto volviera a devolver el preview teniendo cuerpo, el vet
  // vuelve a leer 200 caracteres de un correo de dos páginas.
  it("NUNCA prefiere el preview cuando hay cuerpo", () => {
    const cuerpo = largo(LARGO_DEL_PREVIEW * 3)
    expect(cuerpoLegible({ cuerpo, preview: largo(LARGO_DEL_PREVIEW), cuerpoCompleto: true }).texto).toBe(cuerpo)
  })
})

describe("cuerpoLegible — cuando el proveedor no entregó el cuerpo", () => {
  // Graph (Outlook) a veces sólo manda `bodyPreview` en un listado: ahí `cuerpo` llega vacío.
  it("cae al preview y ADVIERTE si llegó al tope del recorte", () => {
    const r = cuerpoLegible({ cuerpo: "", preview: largo(LARGO_DEL_PREVIEW) })
    expect(r.texto).toHaveLength(LARGO_DEL_PREVIEW)
    expect(r.completo).toBe(false)
  })

  it("un correo corto sin cuerpo está COMPLETO: advertir ahí sería ruido", () => {
    const r = cuerpoLegible({ cuerpo: null, preview: "Confirmado, nos vemos el jueves." })
    expect(r.texto).toBe("Confirmado, nos vemos el jueves.")
    expect(r.completo).toBe(true)
  })

  // El caso que hace falta distinguir: Outlook puede devolver el mismo texto en los dos campos, y
  // entonces tener `cuerpo` no prueba nada sobre si está entero.
  it("cuerpo IGUAL al preview no cuenta como cuerpo completo si llegó al tope", () => {
    const mismo = largo(LARGO_DEL_PREVIEW)
    expect(cuerpoLegible({ cuerpo: mismo, preview: mismo }).completo).toBe(false)
  })

  // EL CASO QUE LA VERSIÓN ANTERIOR DABA POR BUENO. Graph manda un `bodyPreview` de 255 caracteres
  // sin `body`: el adaptador lo guarda entero en `cuerpo` y recortado a 200 en `preview`. Difieren,
  // y la primera versión concluía "hay cuerpo completo" sobre un correo de dos páginas.
  it("un preview largo NO es el correo entero, aunque difiera del recorte", () => {
    const r = cuerpoLegible({ cuerpo: largo(255), preview: largo(LARGO_DEL_PREVIEW), cuerpoCompleto: false })
    expect(r.completo).toBe(false)
  })

  it("pero sí cuando el correo simplemente era corto", () => {
    expect(cuerpoLegible({ cuerpo: "Gracias.", preview: "Gracias." }).completo).toBe(true)
  })

  it("sin nada que mostrar, no inventa ni advierte de más", () => {
    expect(cuerpoLegible({})).toEqual({ texto: "", completo: true })
  })

  it("el espacio en blanco no cuenta como cuerpo", () => {
    expect(cuerpoLegible({ cuerpo: "   \n  ", preview: "Hola" }).texto).toBe("Hola")
  })
})

// La costura de reporte de errores. Es lo único testeable de A1 sin DOM: los tres boundaries son
// componentes de React y vitest acá corre en `environment: "node"`.
import { afterEach, describe, expect, it, vi } from "vitest"

import { codigoDeReporte, reportarError } from "@/lib/errores"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("codigoDeReporte", () => {
  // El digest es lo ÚNICO que conecta "se me rompió" con el log del servidor: en producción Next no
  // manda el mensaje real al navegador. Si esto devuelve el digest, la pantalla lo puede mostrar.
  it("devuelve el digest cuando lo hay", () => {
    expect(codigoDeReporte({ digest: "a1b2c3d4" })).toBe("a1b2c3d4")
  })

  // En desarrollo no hay digest. Devolver `null` es lo que hace que la pantalla NO pinte un
  // "Código: undefined" que no le sirve a nadie.
  it("devuelve null cuando no hay digest", () => {
    expect(codigoDeReporte({})).toBeNull()
    expect(codigoDeReporte({ digest: undefined })).toBeNull()
  })
})

describe("reportarError", () => {
  it("reporta mensaje, digest y stack", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = Object.assign(new Error("supabase se cayó"), { digest: "deadbeef" })

    reportarError(error, "dashboard")

    expect(spy).toHaveBeenCalledTimes(1)
    const [etiqueta, datos] = spy.mock.calls[0]
    expect(etiqueta).toBe("[tuvetia:dashboard]")
    expect(datos).toMatchObject({ mensaje: "supabase se cayó", digest: "deadbeef" })
    expect((datos as { stack: string | null }).stack).toContain("Error")
  })

  it("no revienta si el error viene sin digest", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => reportarError(new Error("pelado"), "global")).not.toThrow()
    expect(spy.mock.calls[0][1]).toMatchObject({ mensaje: "pelado", digest: null })
  })

  // Cada boundary se identifica distinto: sin esto, un fallo del layout raíz y uno de una página
  // del dashboard se verían iguales en el log, y son problemas muy distintos.
  it("distingue de dónde vino el fallo", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    reportarError(new Error("x"), "raiz")
    reportarError(new Error("x"), "dashboard")
    reportarError(new Error("x"), "global")

    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      "[tuvetia:app]",
      "[tuvetia:dashboard]",
      "[tuvetia:layout-raiz]",
    ])
  })
})

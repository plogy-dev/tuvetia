// La costura de reporte de errores. Es lo único testeable de A1 sin DOM: los tres boundaries son
// componentes de React y vitest acá corre en `environment: "node"`.
//
// A partir del 2026-08-16 cubre también la mitad de SERVIDOR, que entra por
// `instrumentation.ts :: onRequestError`. Lo que se prueba de esa mitad son dos cosas con razones
// opuestas:
//
//  · Que NO llegue el control de flujo de Next. `redirect()` y `notFound()` funcionan lanzando
//    errores; sin filtro, cada redirección de login y cada 404 legítimo entra al tracker. Uno lleno
//    de ruido se deja de mirar, que es el mismo final que no tener ninguno.
//  · Que SÍ llegue todo lo demás, incluido lo que no es un `Error`. En JavaScript se puede lanzar un
//    string, un objeto o `undefined`, y un reporte que asuma `.message` se cae justo cuando más
//    falta hace.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const captureException = vi.fn()
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
  init: vi.fn(),
}))

import {
  codigoDeReporte,
  esControlDeFlujoDeNext,
  formaDelReporte,
  reportarError,
  reportarErrorDeServidor,
  vaAlTracker,
} from "@/lib/errores"

const SERVIDOR = {
  ruta: "/api/cron/briefing",
  metodo: "GET",
  tipo: "route",
  archivo: "/api/cron/briefing/route",
}

beforeEach(() => {
  captureException.mockClear()
})

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

describe("el control de flujo de Next no es un error", () => {
  // Su propia documentación lo dice: «APIs like redirect() and notFound() work by throwing special
  // errors under the hood».
  it("una redirección no se reporta", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const e = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/login;307;" })

    expect(esControlDeFlujoDeNext(e)).toBe(true)
    reportarErrorDeServidor(e, SERVIDOR)
    expect(captureException).not.toHaveBeenCalled()
  })

  // El digest de `notFound()` cambió de nombre entre versiones de Next — por eso se detecta por
  // PREFIJO y no con una lista cerrada que envejecería en silencio.
  it("un 404 tampoco, con cualquiera de los dos nombres que Next usó", () => {
    for (const digest of ["NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK;404"]) {
      expect(esControlDeFlujoDeNext(Object.assign(new Error("x"), { digest }))).toBe(true)
    }
  })

  // Los digest de errores REALES son hashes hexadecimales: no colisionan con el prefijo `NEXT_`.
  it("un error de verdad CON digest sí se reporta", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const e = Object.assign(new Error("la base no respondió"), { digest: "3792831045" })

    expect(vaAlTracker(e)).toBe(true)
    reportarErrorDeServidor(e, SERVIDOR)
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it("un error sin digest se reporta", () => {
    expect(vaAlTracker(new Error("boom"))).toBe(true)
  })

  it("lo que no es un objeto no se confunde con control de flujo", () => {
    expect(esControlDeFlujoDeNext("NEXT_REDIRECT")).toBe(false)
    expect(esControlDeFlujoDeNext(null)).toBe(false)
    expect(esControlDeFlujoDeNext(undefined)).toBe(false)
  })
})

describe("se puede lanzar cualquier cosa, no sólo un Error", () => {
  // `onRequestError` tipa el error como `unknown` y la documentación avisa de por qué: puede no ser
  // el error original, porque React lo procesa cuando ocurre al renderizar un Server Component.
  it("un Error da mensaje, digest y stack", () => {
    const r = formaDelReporte(Object.assign(new Error("boom"), { digest: "abc123" }))
    expect(r).toMatchObject({ mensaje: "boom", digest: "abc123" })
    expect(r.stack).toContain("Error")
  })

  it("un string lanzado no rompe el reporte", () => {
    expect(formaDelReporte("algo salió mal")).toEqual({
      mensaje: "algo salió mal",
      digest: null,
      stack: null,
    })
  })

  it("undefined tampoco", () => {
    expect(formaDelReporte(undefined).mensaje).toBe("undefined")
  })

  it("un objeto cualquiera tampoco", () => {
    expect(formaDelReporte({ code: 500 }).mensaje).toBe("[object Object]")
  })
})

describe("lo que se le cuenta al tracker", () => {
  // El TIPO es lo que separa fallos de naturaleza distinta: un `route` es un cron que nadie está
  // mirando, un `action` es un vet esperando frente a un formulario. Sin esa etiqueta, todo cae en
  // la misma bolsa y el tracker deja de responder "¿qué se rompió?".
  it("un error de servidor viaja con su tipo, su archivo y su ruta", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    reportarErrorDeServidor(new Error("el barrido falló"), SERVIDOR)

    const [, opciones] = captureException.mock.calls[0]
    expect(opciones.tags).toMatchObject({ lado: "servidor", tipo: "route" })
    expect(opciones.extra).toMatchObject({ ruta: "/api/cron/briefing", metodo: "GET" })
  })

  it("un error de cliente viaja distinguido del de servidor", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    reportarError(new Error("boom"), "dashboard")

    const [, opciones] = captureException.mock.calls[0]
    expect(opciones.tags).toMatchObject({ lado: "cliente", donde: "dashboard" })
  })

  // Sin DSN, `captureException` es un no-op del propio SDK: la consola es lo único que queda, así
  // que tiene que seguir escribiéndose siempre.
  it("además del tracker, siempre queda el rastro en consola", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    reportarErrorDeServidor(new Error("boom"), SERVIDOR)
    expect(spy).toHaveBeenCalled()
  })

  it("el control de flujo no ensucia ni la consola", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    reportarErrorDeServidor(Object.assign(new Error("x"), { digest: "NEXT_REDIRECT" }), SERVIDOR)
    expect(spy).not.toHaveBeenCalled()
  })
})

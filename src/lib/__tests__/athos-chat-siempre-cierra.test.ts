/**
 * `athosChat` no puede resolver en silencio: o avisa que terminó, o avisa que falló.
 *
 * ── LO QUE PASÓ (28-ago, reporte de David) ────────────────────────────────────────────────────
 *
 * «Nuevos chats … el athos … sirven una vez o dos y después fallan.»
 *
 * El consumidor de esta función —`athos/consultation-thread.tsx`— apagaba su `loading` DENTRO de
 * `onDone` y de `onError`, y no tenía `finally`. O sea que si `athosChat` no llamaba a ninguno de
 * los dos, `loading` quedaba en `true`: el botón de enviar queda `disabled`, la burbuja del
 * asistente se queda con el cursor parpadeando, y la guarda `if (!q || loading) return` bloquea
 * toda pregunta posterior. Sólo se sale recargando la página.
 *
 * Y había DOS caminos que resolvían sin avisar:
 *
 *   1. el bucle corta con `break` cuando el stream termina — y si el servidor cerró sin mandar
 *      `{"type":"done"}` (un proxy que corta, un timeout, un error a mitad de stream, o un último
 *      evento incompleto que se queda en el buffer), no se llamaba a nadie;
 *   2. un `AbortError`, que se tragaba a propósito.
 *
 * El (2) es correcto y se conserva: abortar es una salida deliberada. El (1) es el defecto.
 *
 * Se prueba acá y no en el componente porque el defecto es de ESTA función: el `finally` del hilo
 * es el cinturón, y esto es el tirante.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}))

const { athosChat } = await import("@/lib/athos")

/** Un cuerpo SSE que entrega los trozos dados y después se cierra. */
function cuerpo(trozos: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(c) {
      if (i < trozos.length) c.enqueue(enc.encode(trozos[i++]))
      else c.close()
    },
  })
}

const responder = (trozos: string[]) =>
  vi.fn(async () => new Response(cuerpo(trozos), { status: 200 }))

const handlers = () => ({
  onWarning: vi.fn(),
  onToken: vi.fn(),
  onDone: vi.fn(),
  onError: vi.fn(),
})

const original = globalThis.fetch

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  globalThis.fetch = original
})

describe("athosChat siempre cierra el turno", () => {
  it("con un `done` normal avisa por onDone y no por onError", async () => {
    globalThis.fetch = responder([
      'data: {"type":"token","text":"Hola"}\n\n',
      'data: {"type":"done","citations":[]}\n\n',
    ]) as unknown as typeof fetch
    const h = handlers()

    await athosChat({ question: "¿?", clinicId: "c1" }, h)

    expect(h.onToken).toHaveBeenCalledWith("Hola")
    expect(h.onDone).toHaveBeenCalledTimes(1)
    expect(h.onError).not.toHaveBeenCalled()
  })

  it("si el stream se cierra SIN `done`, avisa por onError en vez de callarse", async () => {
    // El defecto exacto: antes esto resolvía sin llamar a nadie y el hilo quedaba colgado.
    globalThis.fetch = responder([
      'data: {"type":"token","text":"Una respuesta a medias"}\n\n',
    ]) as unknown as typeof fetch
    const h = handlers()

    await athosChat({ question: "¿?", clinicId: "c1" }, h)

    expect(h.onToken).toHaveBeenCalledWith("Una respuesta a medias")
    expect(
      h.onDone.mock.calls.length + h.onError.mock.calls.length,
      "nadie avisó del final: el `loading` del hilo se queda en true para siempre",
    ).toBe(1)
    expect(h.onError).toHaveBeenCalledTimes(1)
  })

  it("un último evento incompleto tampoco puede dejar el turno mudo", async () => {
    // El trozo final se queda en `buffer` y se descarta: mismo agujero, otra puerta.
    globalThis.fetch = responder(['data: {"type":"token","text":"x"}\n\ndata: {"ty']) as unknown as typeof fetch
    const h = handlers()

    await athosChat({ question: "¿?", clinicId: "c1" }, h)

    expect(h.onError).toHaveBeenCalledTimes(1)
  })

  it("un HTTP no-OK sigue avisando UNA sola vez", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch
    const h = handlers()

    await athosChat({ question: "¿?", clinicId: "c1" }, h)

    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.onDone).not.toHaveBeenCalled()
  })

  it("un aborto NO avisa: es una salida deliberada, no un fallo", async () => {
    // La otra mitad del contrato. Si el aborto avisara, cada desmontaje del hilo pintaría un toast
    // de error que el vet no provocó. El `finally` del componente es el que repone su estado.
    const corte = new AbortController()
    globalThis.fetch = vi.fn(async () => {
      corte.abort()
      throw Object.assign(new Error("abortado"), { name: "AbortError" })
    }) as unknown as typeof fetch
    const h = handlers()

    await athosChat({ question: "¿?", clinicId: "c1" }, h, corte.signal)

    expect(h.onError).not.toHaveBeenCalled()
    expect(h.onDone).not.toHaveBeenCalled()
  })
})

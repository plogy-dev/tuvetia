import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Molde tomado de `athos-live.test.ts`: se stubean las APIs del navegador con `vi.stubGlobal` y se
// prueba el módulo real. Es lo que hace testeable la grabación sin un micrófono ni una pantalla —
// justo lo que faltaba cuando esto vivía dentro de un componente.

const detener = vi.fn(async () => {})
const finalizar = vi.fn(async () => true)
const cerrar = vi.fn()
const enviarAudio = vi.fn(async () => {})

vi.mock("@/lib/athos-live", () => ({
  LiveTranscription: {
    open: vi.fn(async () => ({ activa: true, detener, finalizar, cerrar, enviarAudio })),
  },
}))
vi.mock("@/lib/athos", () => ({ athosTranscribe: vi.fn(async () => ({})) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

// Tipada con los argumentos porque los tests del flush inspeccionan QUÉ blob se subió, no sólo que
// se haya subido.
const upload = vi.fn(async (_path: string, _blob: unknown) => ({ error: null }))
/** Los trozos que terminaron dentro del blob que se subió. */
const trozosSubidos = () =>
  (upload.mock.calls[0]?.[1] as { partes?: unknown[] } | undefined)?.partes ?? []
const insert = vi.fn(async () => ({ error: null }))
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload }) },
    from: () => ({ insert }),
  }),
}))

class FakeRecorder {
  static ultima: FakeRecorder | null = null
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  estado = "inactive"
  constructor() {
    FakeRecorder.ultima = this
  }
  start() {
    this.estado = "recording"
  }
  /** Un navegador de verdad deja de emitir `dataavailable` en pausa, sin soltar el micrófono. */
  pause() {
    this.estado = "paused"
  }
  resume() {
    this.estado = "recording"
  }
  /**
   * El flush final va en una TAREA, no síncrono — que es lo que hace un navegador de verdad:
   * `stop()` encola una tarea que dispara `dataavailable` y después `stop`.
   *
   * El `setTimeout` es el punto del fake, no un detalle. Antes este `stop()` era un no-op que no
   * entregaba NINGÚN trozo final, así que ningún test podía ver que el blob se armaba sin él. Si
   * acá se disparara síncrono, el test volvería a pasar con el defecto puesto.
   */
  stop() {
    this.estado = "inactive"
    setTimeout(() => {
      this.ondataavailable?.({ data: TROZO_FINAL as unknown as Blob })
      this.onstop?.()
    }, 0)
  }
}

/** Lleva `size` porque `sesion.ts` descarta los trozos vacíos con `if (e.data.size > 0)`. */
const TROZO_FINAL = { size: 7, marca: "trozo-final" }

/**
 * `detener()` espera el flush del grabador, y el fake lo entrega en una tarea. Con `useFakeTimers`
 * hay que avanzar el reloj MIENTRAS se espera la promesa — no antes (la tarea todavía no está
 * encolada) ni después (nunca llega a encolarse y el await no vuelve).
 */
async function detenerYEsperar(sesion: { detener: (m?: "normal" | "perdida") => Promise<void> }) {
  const fin = sesion.detener()
  await vi.advanceTimersByTimeAsync(10)
  await fin
}

function fakeStream() {
  const track = { stop: vi.fn(), onended: null as null | (() => void) }
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } }
}

let pista: ReturnType<typeof fakeStream>

beforeEach(async () => {
  // Cada test estrena el módulo: `sesion.ts` guarda su estado a nivel de módulo (es el punto —
  // sobrevive al desmontaje de React), y sin esto una sesión "grabando" se filtra al test siguiente
  // y el cerrojo de sesión única lo rechaza. Es la contracara de que el estado sea global.
  vi.resetModules()
  vi.useFakeTimers()
  pista = fakeStream()
  vi.stubGlobal("MediaRecorder", FakeRecorder)
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => pista.stream) } })
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" })
  const guardado = new Map<string, string>()
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => guardado.get(k) ?? null,
    setItem: (k: string, v: string) => void guardado.set(k, v),
    removeItem: (k: string) => void guardado.delete(k),
  })
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal("Blob", class { size = 10; constructor(public partes: unknown[], public opts?: unknown) {} })

})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const params = { consultaId: "c-1", clinicId: "cl-1", pacienteNombre: "Canela" }

describe("consultaViva", () => {
  it("arranca inactiva y pasa a grabando", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    expect(consultaViva.leer().fase).toBe("inactiva")
    await consultaViva.iniciar(params)
    expect(consultaViva.leer().fase).toBe("grabando")
    expect(consultaViva.leer().pacienteNombre).toBe("Canela")
    expect(consultaViva.estaGrabando()).toBe(true)
  })

  it("el snapshot es la MISMA referencia hasta que algo cambia", async () => {
    // Es el contrato de useSyncExternalStore: devolver un objeto nuevo cada vez mete a React en un
    // bucle con "The result of getSnapshot should be cached". Falla ruidosamente, pero en runtime.
    const { consultaViva } = await import("../consulta-viva/sesion")
    const a = consultaViva.leer()
    expect(consultaViva.leer()).toBe(a)
    await consultaViva.iniciar(params)
    const b = consultaViva.leer()
    expect(b).not.toBe(a)
    expect(consultaViva.leer()).toBe(b)
  })

  it("NO deja arrancar una segunda consulta, y lo dice nombrando la primera", async () => {
    // Antes esto era imposible por accidente: navegar cortaba la grabación. La persistencia lo
    // habilita, y dos micrófonos abiertos mezclarían dos consultas en el mismo audio.
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    await expect(
      consultaViva.iniciar({ consultaId: "c-2", clinicId: "cl-1", pacienteNombre: "Manchita" }),
    ).rejects.toThrow(/Canela/)
  })

  it("el cronómetro avanza y notifica a los suscriptores", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    const oyente = vi.fn()
    consultaViva.suscribir(oyente)
    await consultaViva.iniciar(params)
    oyente.mockClear()
    vi.advanceTimersByTime(3000)
    expect(consultaViva.leer().segundos).toBe(3)
    expect(oyente).toHaveBeenCalled()
  })

  it("se corta sola a los 90 minutos", async () => {
    // La persistencia crea este modo de fallo: si navegar ya no detiene la grabación, olvidarse de
    // detenerla pasa a ser lo más probable que puede salir mal.
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    vi.advanceTimersByTime(90 * 60 * 1000)
    await vi.runOnlyPendingTimersAsync()
    expect(consultaViva.leer().fase).not.toBe("grabando")
  })

  it("perder el micrófono cierra la sesión en vez de seguir grabando la nada", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    expect(pista.track.onended).toBeTypeOf("function")
    pista.track.onended?.()
    await vi.runOnlyPendingTimersAsync()
    expect(consultaViva.leer().fase).not.toBe("grabando")
  })

  it("detener corta el vivo ANTES de subir — el final de la consulta es donde está el plan", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    await detenerYEsperar(consultaViva)
    expect(detener).toHaveBeenCalled()
    expect(upload).toHaveBeenCalled()
    expect(detener.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0])
  })

  it("el último trozo del grabador entra en el audio que se sube", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    await detenerYEsperar(consultaViva)
    expect(trozosSubidos()).toContainEqual(TROZO_FINAL)
  })

  it("el último trozo entra TAMBIÉN con la transcripción en vivo caída", async () => {
    // Este es el caso que se rompía, y el único: `LiveTranscription.detener()` arranca con
    // `if (!this.activa) return`, así que sin vivo resuelve en una microtarea. El blob se armaba en
    // esa microtarea — o sea ANTES de la tarea que entrega el `dataavailable` final — y se perdía
    // hasta un segundo del cierre de la consulta, que es donde el vet dicta el plan.
    //
    // Con el vivo ACTIVO el defecto quedaba tapado: ahí `detener()` espera un mensaje del socket, y
    // esa espera alcanzaba para que el trozo llegara. Por eso hay que forzar `activa: false`.
    const { LiveTranscription } = await import("@/lib/athos-live")
    vi.mocked(LiveTranscription.open).mockImplementationOnce(
      async () => ({ activa: false, detener, finalizar, cerrar, enviarAudio }) as never,
    )
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    expect(consultaViva.leer().vivo).toBe(false)
    await detenerYEsperar(consultaViva)
    expect(trozosSubidos()).toContainEqual(TROZO_FINAL)
  })

  it("el micrófono se suelta DESPUÉS del flush, no antes", async () => {
    // Cortar los tracks antes de que el grabador vacíe su buffer es la otra mitad del mismo
    // defecto. Y adelantar la fase a "subiendo" es lo que impide que ese corte se reentre por
    // `track.onended` como si fuera una pérdida de micrófono.
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    const fin = consultaViva.detener()
    expect(consultaViva.leer().fase).toBe("subiendo")
    expect(pista.track.stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10)
    await fin
    expect(pista.track.stop).toHaveBeenCalled()
  })

  it("detener suelta el micrófono aunque la subida falle", async () => {
    // Un fallo de red no puede dejar el micrófono abierto: es lo peor que podría pasar acá.
    upload.mockImplementationOnce(async () => ({ error: { message: "sin red" } }) as never)
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    await detenerYEsperar(consultaViva)
    expect(pista.track.stop).toHaveBeenCalled()
    expect(consultaViva.leer().fase).toBe("perdida")
  })

  it("la migaja se deja al grabar y se borra al detener", async () => {
    const { consultaViva, migajaDeGrabacionPerdida } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    await detenerYEsperar(consultaViva)
    expect(migajaDeGrabacionPerdida()).toBeNull()
  })

  it("la migaja SOBREVIVE si la sesión no se cerró — es el caso de la recarga", async () => {
    const { consultaViva, migajaDeGrabacionPerdida } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    const migaja = migajaDeGrabacionPerdida()
    expect(migaja?.consultaId).toBe("c-1")
    expect(migaja?.pacienteNombre).toBe("Canela")
    // Se consume: el aviso se muestra una sola vez.
    expect(migajaDeGrabacionPerdida()).toBeNull()
  })

  it("si MediaRecorder lanza, NO queda una sesión fantasma — y el micrófono se suelta", async () => {
    // El caso real: `new MediaRecorder(stream, {mimeType:"audio/webm"})` lanza donde ese contenedor
    // no está soportado, o sea en Safari — todo iPhone. La primera versión marcaba "grabando" antes
    // de construirlo, así que la sesión quedaba clavada con el micrófono abierto, el cronómetro sin
    // arrancar y el cerrojo de sesión única impidiendo iniciar otra consulta nunca más.
    vi.stubGlobal("MediaRecorder", class { constructor() { throw new Error("mimeType no soportado") } })
    const { consultaViva } = await import("../consulta-viva/sesion")
    await expect(consultaViva.iniciar(params)).rejects.toThrow(/no soportado/)
    expect(consultaViva.leer().fase).toBe("inactiva")
    expect(consultaViva.estaGrabando()).toBe(false)
    expect(pista.track.stop).toHaveBeenCalled()
    // Y se puede volver a intentar: el cerrojo no quedó trabado.
    vi.stubGlobal("MediaRecorder", FakeRecorder)
    await expect(consultaViva.iniciar(params)).resolves.toBeUndefined()
  })

  it("detener sobre una sesión inactiva no hace nada", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.detener()
    expect(upload).not.toHaveBeenCalled()
  })
})

// ── Pausar la consulta ──────────────────────────────────────────────────────────────────────────
//
// Lo pidió el cliente con captura de pantalla: "posibilidad de pausar la consulta". El caso es la
// jornada real — el titular sale a buscar el carnet, entra alguien, suena el teléfono. Sin pausa,
// las opciones eran grabar eso o cerrar la consulta y perder el hilo.

describe("pausa", () => {
  it("pausa y reanuda, sin cerrar la consulta", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)

    consultaViva.pausar()
    expect(consultaViva.leer().pausada).toBe(true)
    // Sigue siendo una grabación en curso: mantiene el cerrojo y sigue teniendo audio que perder.
    expect(consultaViva.leer().fase).toBe("grabando")
    expect(consultaViva.estaGrabando()).toBe(true)

    consultaViva.reanudar()
    expect(consultaViva.leer().pausada).toBe(false)
  })

  it("le dice al grabador que pare de capturar, sin soltar el micrófono", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)

    consultaViva.pausar()
    expect(FakeRecorder.ultima!.estado).toBe("paused")
    // EL MICRÓFONO SIGUE TOMADO, y tiene que seguirlo: `getUserMedia` exige un gesto del usuario,
    // así que soltarlo haría que reanudar pidiera permiso otra vez.
    expect(pista.track.stop).not.toHaveBeenCalled()

    consultaViva.reanudar()
    expect(FakeRecorder.ultima!.estado).toBe("recording")
  })

  it("el cronómetro visible se congela en pausa", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)

    await vi.advanceTimersByTimeAsync(5000)
    expect(consultaViva.leer().segundos).toBe(5)

    consultaViva.pausar()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(consultaViva.leer().segundos, "en pausa no se está grabando: el reloj no avanza").toBe(5)

    consultaViva.reanudar()
    await vi.advanceTimersByTimeAsync(3000)
    expect(consultaViva.leer().segundos).toBe(8)
  })

  // EL AGUJERO QUE ABRE LA PAUSA, y por qué hay dos contadores. El tope de 90 minutos no mide la
  // consulta: existe porque un micrófono tomado toda la tarde es audio de terceros que nadie
  // consintió. Si contara sólo lo grabado, pausar y olvidarse lo dejaría abierto para siempre.
  it("el tope de 90 minutos cuenta el reloj de pared, no lo grabado", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)

    consultaViva.pausar()
    // Una tarde entera en pausa. Con el cronómetro visible congelado en cero.
    await vi.advanceTimersByTimeAsync(91 * 60 * 1000)

    expect(consultaViva.leer().segundos).toBe(0)
    expect(
      consultaViva.leer().fase,
      "una consulta pausada y olvidada tiene que cerrarse sola igual",
    ).not.toBe("grabando")
  })

  it("no se pausa lo que no está grabando", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    consultaViva.pausar()
    expect(consultaViva.leer().pausada).toBe(false)
    expect(consultaViva.leer().fase).toBe("inactiva")
  })

  it("pausar dos veces no hace nada raro, y reanudar sin pausa tampoco", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)

    consultaViva.pausar()
    const tras = consultaViva.leer()
    consultaViva.pausar()
    expect(consultaViva.leer(), "una pausa repetida no debería emitir un estado nuevo").toBe(tras)

    consultaViva.reanudar()
    const activa = consultaViva.leer()
    consultaViva.reanudar()
    expect(consultaViva.leer()).toBe(activa)
  })

  it("se puede cerrar la consulta estando en pausa", async () => {
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    consultaViva.pausar()

    await detenerYEsperar(consultaViva)

    expect(consultaViva.leer().fase).toBe("terminada")
    // El flag no se arrastra: la pastilla diría "en pausa" mientras sube el audio.
    expect(consultaViva.leer().pausada).toBe(false)
    expect(upload).toHaveBeenCalled()
  })

  // Si el navegador no soporta pause (no debería pasar, pero es una API que no está en todos lados),
  // lo honesto es no anunciar una pausa que no ocurrió: el vet creería que dejó de grabarse.
  it("si el grabador no sabe pausar, NO se anuncia una pausa falsa", async () => {
    class SinPausa extends FakeRecorder {
      override pause() {
        throw new Error("no soportado")
      }
    }
    vi.stubGlobal("MediaRecorder", SinPausa)

    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    consultaViva.pausar()

    expect(consultaViva.leer().pausada).toBe(false)
  })
})

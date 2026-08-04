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

const upload = vi.fn(async () => ({ error: null }))
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
  estado = "inactive"
  constructor() {
    FakeRecorder.ultima = this
  }
  start() {
    this.estado = "recording"
  }
  stop() {
    this.estado = "inactive"
  }
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
    await consultaViva.detener()
    expect(detener).toHaveBeenCalled()
    expect(upload).toHaveBeenCalled()
    expect(detener.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0])
  })

  it("detener suelta el micrófono aunque la subida falle", async () => {
    // Un fallo de red no puede dejar el micrófono abierto: es lo peor que podría pasar acá.
    upload.mockImplementationOnce(async () => ({ error: { message: "sin red" } }) as never)
    const { consultaViva } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    await consultaViva.detener()
    expect(pista.track.stop).toHaveBeenCalled()
    expect(consultaViva.leer().fase).toBe("perdida")
  })

  it("la migaja se deja al grabar y se borra al detener", async () => {
    const { consultaViva, migajaDeGrabacionPerdida } = await import("../consulta-viva/sesion")
    await consultaViva.iniciar(params)
    await consultaViva.detener()
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

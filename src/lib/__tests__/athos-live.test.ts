// El cliente de transcripción en vivo: que el protocolo se respete y que NUNCA deje al
// veterinario sin transcripción cuando el socket falla.
import { beforeEach, describe, expect, it, vi } from "vitest"

import { LiveTranscription, toWsUrl } from "@/lib/athos-live"

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt-de-prueba" } } }) },
  }),
}))

/** WebSocket falso: registra lo enviado y permite empujar mensajes del servidor. */
class FakeSocket {
  static ultimo: FakeSocket | null = null
  static OPEN = 1

  url: string
  readyState = 1
  binaryType = ""
  enviado: (string | ArrayBuffer)[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeSocket.ultimo = this
    // `open` en el siguiente tick, como el navegador.
    queueMicrotask(() => this.onopen?.())
  }

  send(d: string | ArrayBuffer) {
    this.enviado.push(d)
  }
  close() {
    this.readyState = 3
  }

  /** Simula un mensaje del servidor. */
  recibir(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent)
  }
}

const crear = (url: string) => new FakeSocket(url) as unknown as WebSocket
const PARAMS = { consultationId: "cons-1", clinicId: "c-1" }

beforeEach(() => {
  FakeSocket.ultimo = null
  vi.stubGlobal("WebSocket", FakeSocket)
})

describe("toWsUrl", () => {
  it("convierte https a wss", () => {
    expect(toWsUrl("https://athos.example.com", "/x")).toBe("wss://athos.example.com/x")
  })
  it("convierte http a ws", () => {
    expect(toWsUrl("http://localhost:8000", "/x")).toBe("ws://localhost:8000/x")
  })
  it("ignora la barra final", () => {
    expect(toWsUrl("https://a.com/", "/x")).toBe("wss://a.com/x")
  })
})

describe("LiveTranscription", () => {
  it("manda el init con el token en el CUERPO, no en la URL", async () => {
    const live = await LiveTranscription.open(PARAMS, {}, crear)
    const s = FakeSocket.ultimo!
    // El JWT en la query string queda en los logs del proxy: es una credencial filtrada.
    expect(s.url).not.toContain("jwt-de-prueba")
    expect(JSON.parse(s.enviado[0] as string)).toEqual({
      type: "init",
      token: "jwt-de-prueba",
      clinic_id: "c-1",
      consultation_id: "cons-1",
    })
    expect(live.activa).toBe(true)
  })

  it("reporta el texto estable y el provisional por separado", async () => {
    const vistos: [string, string][] = []
    await LiveTranscription.open(PARAMS, { onText: (e, p) => vistos.push([e, p]) }, crear)
    const s = FakeSocket.ultimo!
    s.recibir({ type: "text", estable: "", provisional: "Doctor", final: false })
    s.recibir({ type: "text", estable: "Titular: Doctor mi perro", provisional: "", final: true })
    expect(vistos).toEqual([
      ["", "Doctor"],
      ["Titular: Doctor mi perro", ""],
    ])
  })

  it("reenvía el audio sin transformarlo", async () => {
    const live = await LiveTranscription.open(PARAMS, {}, crear)
    const s = FakeSocket.ultimo!
    await live.enviarAudio(new Blob([new Uint8Array([26, 69, 223, 163])]))
    const enviado = s.enviado[1] as ArrayBuffer
    expect(new Uint8Array(enviado)).toEqual(new Uint8Array([26, 69, 223, 163]))
  })

  it("detener espera el stopped del servidor", async () => {
    const live = await LiveTranscription.open(PARAMS, {}, crear)
    const s = FakeSocket.ultimo!
    let resuelto = false
    const p = live.detener().then(() => (resuelto = true))
    await Promise.resolve()
    expect(resuelto).toBe(false) // sigue esperando
    expect(JSON.parse(s.enviado[1] as string)).toEqual({ type: "stop" })
    s.recibir({ type: "stopped", estable: "Titular: hola", palabras: 2 })
    await p
    expect(resuelto).toBe(true)
  })

  it("finalizar manda el audio_id y devuelve lo guardado", async () => {
    const live = await LiveTranscription.open(PARAMS, {}, crear)
    const s = FakeSocket.ultimo!
    const p = live.finalizar("aud-9")
    await Promise.resolve()
    expect(JSON.parse(s.enviado[1] as string)).toEqual({ type: "finalize", audio_id: "aud-9" })
    s.recibir({ type: "saved", transcript_id: "t-1", full_text: "Titular: hola" })
    expect(await p).toEqual({ transcript_id: "t-1", full_text: "Titular: hola" })
  })

  // ---------- degradación: lo que garantiza que no se pierda una consulta ----------

  it("un error del servidor avisa fallback y desactiva la sesión", async () => {
    const motivos: string[] = []
    const live = await LiveTranscription.open(PARAMS, { onFallback: (m) => motivos.push(m) }, crear)
    FakeSocket.ultimo!.recibir({ type: "error", detalle: "falta DEEPGRAM_API_KEY", fallback: true })
    expect(motivos).toEqual(["falta DEEPGRAM_API_KEY"])
    expect(live.activa).toBe(false)
  })

  it("finalizar devuelve null si la sesión se cayó — el grabador cae al lote", async () => {
    const live = await LiveTranscription.open(PARAMS, {}, crear)
    FakeSocket.ultimo!.recibir({ type: "error", detalle: "se cayó", fallback: true })
    expect(await live.finalizar("aud-9")).toBeNull()
  })

  it("una caída mientras se espera NO deja colgado al veterinario", async () => {
    // Si `detener()` sólo resolviera con `stopped`, una caída lo dejaría esperando su timeout
    // completo con la rueda girando. Debe resolver en cuanto se marca el fallback.
    const live = await LiveTranscription.open(PARAMS, {}, crear)
    const p = live.detener()
    FakeSocket.ultimo!.recibir({ type: "error", detalle: "se cayó", fallback: true })
    await expect(p).resolves.toBeUndefined()
  })

  it("si el socket se cierra antes de guardar, se marca fallback", async () => {
    const motivos: string[] = []
    const live = await LiveTranscription.open(PARAMS, { onFallback: (m) => motivos.push(m) }, crear)
    FakeSocket.ultimo!.onclose?.()
    expect(live.activa).toBe(false)
    expect(motivos).toHaveLength(1)
  })

  it("enviar audio con la sesión caída no lanza", async () => {
    const live = await LiveTranscription.open(PARAMS, {}, crear)
    FakeSocket.ultimo!.recibir({ type: "error", detalle: "x", fallback: true })
    await expect(live.enviarAudio(new Blob(["x"]))).resolves.toBeUndefined()
  })
})

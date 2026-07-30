// Transcripción EN VIVO del Modo Fantasma: WebSocket contra Athos mientras el vet habla.
//
// El camino por lotes (`athosTranscribe`) sigue siendo la RED DE SEGURIDAD. Este módulo nunca lanza
// para "no se pudo transcribir en vivo": devuelve una sesión que reporta `fallback` y el grabador
// transcribe al cerrar, exactamente como antes. Una consulta clínica no se puede perder porque un
// socket se cayó.
//
// Protocolo (servidor: `athos-service/app/streaming_transcription.py`):
//   init -> ready -> <audio> -> text… -> stop -> stopped -> finalize -> saved
import { createClient } from "@/lib/supabase/client"

const ATHOS_URL = process.env.NEXT_PUBLIC_ATHOS_URL ?? ""

export type LiveHandlers = {
  /** Texto confirmado + la hipótesis en curso, para pintar la consulta mientras ocurre. */
  onText?: (estable: string, provisional: string) => void
  /** El vivo no está disponible: hay que transcribir por lotes al cerrar. */
  onFallback?: (motivo: string) => void
}

/** `https://host` -> `wss://host`. El navegador no acepta http(s):// en `new WebSocket()`. */
export function toWsUrl(base: string, path: string): string {
  const limpio = (base || "").replace(/\/+$/, "")
  if (limpio.startsWith("https://")) return `wss://${limpio.slice(8)}${path}`
  if (limpio.startsWith("http://")) return `ws://${limpio.slice(7)}${path}`
  // Sin base configurada: mismo origen que la página.
  if (!limpio && typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${proto}//${window.location.host}${path}`
  }
  return `${limpio}${path}`
}

type SocketFactory = (url: string) => WebSocket

export class LiveTranscription {
  private ws: WebSocket | null = null
  private handlers: LiveHandlers
  private saved: { transcript_id: string; full_text: string } | null = null
  private caido = false
  private esperandoStop: (() => void) | null = null
  private esperandoSaved: ((v: { transcript_id: string; full_text: string } | null) => void) | null =
    null

  private constructor(handlers: LiveHandlers) {
    this.handlers = handlers
  }

  /** ¿Sigue viva? Si no, el grabador debe transcribir por lotes. */
  get activa(): boolean {
    return !this.caido && this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Abre la sesión y espera el `ready`. NUNCA lanza: si algo falla marca fallback y devuelve la
   * instancia igual, para que el llamador no tenga que envolver todo en try/catch.
   */
  static async open(
    params: { consultationId: string; clinicId: string },
    handlers: LiveHandlers = {},
    crearSocket: SocketFactory = (url) => new WebSocket(url),
  ): Promise<LiveTranscription> {
    const live = new LiveTranscription(handlers)
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error("sesión no válida")

      const ws = crearSocket(toWsUrl(ATHOS_URL, "/athos/transcribe/live"))
      ws.binaryType = "arraybuffer"
      live.ws = ws
      ws.onmessage = (ev) => live.recibir(ev)
      ws.onerror = () => live.marcarCaido("error de conexión")
      ws.onclose = () => {
        // Un cierre después de guardar es lo normal; antes, no.
        if (!live.saved) live.marcarCaido("la conexión se cerró")
      }

      await new Promise<void>((resolve, reject) => {
        const tope = setTimeout(() => reject(new Error("tiempo de espera agotado")), 8000)
        ws.onopen = () => {
          clearTimeout(tope)
          ws.send(
            JSON.stringify({
              type: "init",
              token: session.access_token,
              clinic_id: params.clinicId,
              consultation_id: params.consultationId,
            }),
          )
          resolve()
        }
        const errorOriginal = ws.onerror
        ws.onerror = (e) => {
          clearTimeout(tope)
          errorOriginal?.call(ws, e as Event)
          reject(new Error("no se pudo conectar"))
        }
      })
    } catch (e) {
      live.marcarCaido((e as Error).message)
    }
    return live
  }

  /** Manda un trozo de audio tal cual: si se toca, Deepgram no decodifica el contenedor webm. */
  async enviarAudio(trozo: Blob): Promise<void> {
    if (!this.activa) return
    try {
      this.ws!.send(await trozo.arrayBuffer())
    } catch {
      this.marcarCaido("no se pudo enviar el audio")
    }
  }

  /** Cierra la entrada de audio y espera a que Deepgram vacíe lo pendiente. */
  async detener(): Promise<void> {
    if (!this.activa) return
    const espera = new Promise<void>((resolve) => {
      this.esperandoStop = resolve
      setTimeout(resolve, 15000) // no dejar al vet esperando por un socket mudo
    })
    this.ws!.send(JSON.stringify({ type: "stop" }))
    await espera
  }

  /**
   * Persiste el transcript. Sólo se puede llamar con el audio YA subido: `transcripts.audio_id`
   * tiene FK a `consultation_audios`. Devuelve null si hay que caer al lote.
   */
  async finalizar(audioId: string): Promise<{ transcript_id: string; full_text: string } | null> {
    if (!this.activa) return null
    const espera = new Promise<{ transcript_id: string; full_text: string } | null>((resolve) => {
      this.esperandoSaved = resolve
      setTimeout(() => resolve(null), 20000)
    })
    this.ws!.send(JSON.stringify({ type: "finalize", audio_id: audioId }))
    return await espera
  }

  cerrar(): void {
    try {
      this.ws?.close()
    } catch {
      /* ya estaba cerrado */
    }
  }

  // ---------- interno ----------

  private recibir(ev: MessageEvent): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "")
    } catch {
      return
    }
    switch (msg.type) {
      case "text":
        this.handlers.onText?.(String(msg.estable ?? ""), String(msg.provisional ?? ""))
        break
      case "stopped":
        this.handlers.onText?.(String(msg.estable ?? ""), "")
        this.esperandoStop?.()
        this.esperandoStop = null
        break
      case "saved":
        this.saved = {
          transcript_id: String(msg.transcript_id ?? ""),
          full_text: String(msg.full_text ?? ""),
        }
        this.esperandoSaved?.(this.saved)
        this.esperandoSaved = null
        break
      case "error":
        this.marcarCaido(String(msg.detalle ?? "sesión en vivo no disponible"))
        break
    }
  }

  private marcarCaido(motivo: string): void {
    if (this.caido) return
    this.caido = true
    // Desbloquea a quien esté esperando: si no, `detener()`/`finalizar()` se comen su timeout
    // completo y el veterinario mira una rueda girando 15 segundos de más.
    this.esperandoStop?.()
    this.esperandoStop = null
    this.esperandoSaved?.(null)
    this.esperandoSaved = null
    this.handlers.onFallback?.(motivo)
  }
}

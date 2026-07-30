"use client"

// Modo Fantasma — captura de la consulta.
// Flujo: consentimiento (Ley 1581, BLOQUEANTE) -> grabar -> subir al bucket privado
// -> registrar consultation_audios -> pedir transcripción (Deepgram) -> avisar al padre.
// Sin consentimiento no se habilita el micrófono; además la BD lo bloquea por trigger.
//
// La transcripción va EN VIVO por WebSocket (`LiveTranscription`): el vet ve el texto mientras
// habla. El audio se sigue subiendo igual —hace falta para la retención de 4 días— y el camino
// por lotes queda de RED DE SEGURIDAD: si el vivo se cae, se transcribe al cerrar como antes.

import { useCallback, useEffect, useRef, useState } from "react"
import { AudioLines, Loader2, Mic, ShieldCheck, Square } from "lucide-react"
import { toast } from "sonner"

import { athosTranscribe } from "@/lib/athos"
import { LiveTranscription } from "@/lib/athos-live"
import { createClient } from "@/lib/supabase/client"
import { HelpTip } from "@/components/help-tip"
import { Button } from "@/components/ui/button"

const AUDIO_BUCKET = "consultation-audios"
// Versión del texto mostrado al titular. Si cambia el texto, sube la versión:
// queda registrada en consents.text_version como evidencia de QUÉ se aceptó.
const CONSENT_TEXT_VERSION = "v1-2026-07"
const CONSENT_SCOPE = ["audio_recording", "transcription", "clinical_note"]

type Phase = "idle" | "consent" | "recording" | "uploading" | "transcribing" | "done"

export function ConsultationRecorder({
  consultationId,
  clinicId,
  patientId,
  ownerId,
  patientName,
  onTranscribed,
}: {
  consultationId: string
  clinicId: string
  patientId: string
  ownerId?: string | null
  patientName?: string
  onTranscribed?: () => void
}) {
  const [supabase] = useState(() => createClient())
  const [phase, setPhase] = useState<Phase>("idle")
  const [seconds, setSeconds] = useState(0)

  // Texto en vivo: `estable` es lo confirmado, `provisional` la hipótesis que Deepgram reemplaza.
  const [estable, setEstable] = useState("")
  const [provisional, setProvisional] = useState("")
  // En estado, no en ref: el indicador "transcribiendo en vivo" tiene que re-renderizar cuando
  // la sesión se cae a mitad de consulta.
  const [vivo, setVivo] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveRef = useRef<LiveTranscription | null>(null)
  // `handleStop` se engancha a rec.onstop al arrancar (cuando seconds=0), así que su closure
  // veía siempre 0 -> duration_secs quedaba en 0. El ref se lee al detener y está siempre al día.
  const secondsRef = useRef(0)

  // Limpieza: si el componente se desmonta grabando, soltamos el micrófono y el socket.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      liveRef.current?.cerrar()
    }
  }, [])

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`

  // El flujo se lee 1) consentimiento -> 2) grabación -> 3) subida, pero se declara al revés:
  // `acceptConsent` es un useCallback y el lint (react-hooks/immutability) no admite que un valor
  // memoizado lea algo declarado más abajo.

  // 2) Grabación
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      setEstable("")
      setProvisional("")

      // Sesión en vivo. `open` no lanza nunca: si no se pudo, `activa` queda en false y todo
      // sigue igual que antes (transcripción por lotes al cerrar).
      const live = await LiveTranscription.open(
        { consultationId, clinicId },
        {
          onText: (est, prov) => {
            setEstable(est)
            setProvisional(prov)
          },
          onFallback: (motivo) => {
            setVivo(false)
            // Sin toast de error: para el veterinario no cambia nada, sólo deja de ver el texto
            // en vivo. Que la consulta se transcriba igual es lo que importa.
            console.info(`[fantasma] transcripción en vivo no disponible: ${motivo}`)
          },
        },
      )
      liveRef.current = live
      setVivo(live.activa)

      const rec = new MediaRecorder(stream, {
        mimeType: "audio/webm",
        audioBitsPerSecond: 48000,
      })
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
          // El MISMO trozo va al bucket (acumulado) y a Deepgram (en vivo). No se transforma:
          // el primer trozo lleva la cabecera del contenedor webm y sin ella no decodifica.
          void liveRef.current?.enviarAudio(e.data)
        }
      }
      rec.onstop = () => void handleStop()
      rec.start(1000)
      recorderRef.current = rec
      secondsRef.current = 0
      setSeconds(0)
      setPhase("recording")
      timerRef.current = setInterval(() => {
        secondsRef.current += 1
        setSeconds(secondsRef.current)
      }, 1000)
    } catch (e) {
      toast.error(
        `No se pudo acceder al micrófono: ${(e as Error).message}. Revisa los permisos del navegador.`,
      )
      setPhase("idle")
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current)
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }

  // 3) Subida + registro + transcripción
  async function handleStop() {
    setPhase("uploading")
    const blob = new Blob(chunksRef.current, { type: "audio/webm" })
    const duration = secondsRef.current
    const live = liveRef.current
    try {
      // Se le corta la entrada de audio a Deepgram y se esperan sus últimos tramos ANTES de
      // subir: el final de la consulta es donde está el plan, y perderlo sería lo peor.
      await live?.detener()

      const audioId = crypto.randomUUID()
      // La ruta empieza por clinic_id: es lo que usan las policies de Storage para aislar.
      const path = `${clinicId}/${consultationId}/${audioId}.webm`

      const { error: upErr } = await supabase.storage
        .from(AUDIO_BUCKET)
        .upload(path, blob, { contentType: "audio/webm", upsert: false })
      if (upErr) throw new Error(`subida del audio: ${upErr.message}`)

      const { error: rowErr } = await supabase.from("consultation_audios").insert({
        id: audioId,
        clinic_id: clinicId,
        consultation_id: consultationId,
        storage_path: path,
        duration_secs: duration,
        file_size: blob.size,
        encoding: "audio/webm;codecs=opus",
      })
      if (rowErr) throw new Error(`registro del audio: ${rowErr.message}`)

      setPhase("transcribing")
      // Recién ahora existe la fila del audio, que es lo que exige la FK de transcripts.audio_id.
      const guardado = await live?.finalizar(audioId)
      if (!guardado) {
        // El vivo no llegó a guardar: se transcribe por lotes, como antes de que existiera.
        await athosTranscribe({ consultationId, clinicId })
      }
      live?.cerrar()
      setPhase("done")
      toast.success("Consulta transcrita. Ya puedes generar la nota.")
      onTranscribed?.()
    } catch (e) {
      live?.cerrar()
      toast.error(`No se pudo procesar la grabación: ${(e as Error).message}`)
      setPhase("idle")
    }
  }

  // Inserta la fila de consentimiento de ESTA consulta (el trigger de BD la exige siempre).
  // owner_scope=true cuando el titular acepta por primera vez -> cubre sus próximas consultas.
  const insertConsent = useCallback(
    async (ownerScope: boolean) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error("Sesión no válida")
      const { error } = await supabase.from("consents").insert({
        clinic_id: clinicId,
        consultation_id: consultationId,
        patient_id: patientId,
        obtained_by: user.id,
        text_version: CONSENT_TEXT_VERSION,
        scope: CONSENT_SCOPE,
        owner_scope: ownerScope,
      })
      if (error) throw new Error(error.message)
    },
    [supabase, clinicId, consultationId, patientId],
  )

  // 0) Arranque: si el titular YA dio su consentimiento (vigente, no revocado), no se re-pregunta —
  // se registra la fila de esta consulta citando ese consentimiento y se graba directo.
  const beginFlow = useCallback(async () => {
    if (ownerId) {
      const { data: standing } = await supabase.rpc("has_owner_consent", { p_owner_id: ownerId })
      if (standing === true) {
        try {
          await insertConsent(false)
          toast.success("Consentimiento vigente del titular — grabando")
          await startRecording()
          return
        } catch (e) {
          toast.error(`No se pudo registrar el consentimiento: ${(e as Error).message}`)
          return
        }
      }
    }
    setPhase("consent")
  }, [ownerId, supabase, insertConsent]) // eslint-disable-line react-hooks/exhaustive-deps

  // 1) Consentimiento (primera vez del titular): se registra ANTES de tocar el micrófono.
  const acceptConsent = useCallback(async () => {
    try {
      await insertConsent(true)
    } catch (e) {
      toast.error(`No se pudo registrar el consentimiento: ${(e as Error).message}`)
      return
    }
    await startRecording()
  }, [insertConsent]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- UI ----------
  if (phase === "consent") {
    return (
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-muted-foreground" /> Consentimiento del titular
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Vamos a grabar el audio de esta consulta{patientName ? ` de ${patientName}` : ""} para
          transcribirla y redactar la nota clínica. El audio se conserva 4 días y luego se elimina;
          la transcripción queda en la historia. La autorización del titular <b>cubre también las
          próximas consultas de sus mascotas</b> (no se le volverá a preguntar) y puede revocarla en
          cualquier momento (Ley 1581 de 2012).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={acceptConsent}>
            <Mic className="size-4" /> El titular autoriza — empezar a grabar
          </Button>
          <Button variant="outline" onClick={() => setPhase("idle")}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  if (phase === "recording") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
            <span className="font-medium">Grabando consulta</span>
            <span className="font-mono text-muted-foreground">{mmss}</span>
            {vivo && (
              <span className="text-xs text-muted-foreground">· transcribiendo en vivo</span>
            )}
          </div>
          <Button variant="destructive" onClick={stopRecording}>
            <Square className="size-4" /> Detener y transcribir
          </Button>
        </div>

        {(estable || provisional) && (
          <div
            className="mt-3 max-h-48 overflow-y-auto rounded-lg border bg-background p-3 text-sm leading-relaxed"
            aria-live="polite"
            aria-label="Transcripción en vivo"
          >
            {estable.split("\n").map((linea, i) => {
              const [quien, ...resto] = linea.split(":")
              const dicho = resto.join(":").trim()
              if (!dicho) return null
              return (
                <p key={i} className="mb-1">
                  <span className="font-medium text-muted-foreground">{quien}:</span> {dicho}
                </p>
              )
            })}
            {/* La hipótesis en curso va atenuada: Deepgram la reemplaza al confirmar. */}
            {provisional && <p className="text-muted-foreground/60 italic">{provisional}</p>}
          </div>
        )}
      </div>
    )
  }

  if (phase === "uploading" || phase === "transcribing") {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {phase === "uploading" ? "Guardando el audio…" : "Transcribiendo la consulta…"}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm">
        <AudioLines className="size-4 text-muted-foreground" />
        <span>
          {phase === "done"
            ? "Consulta grabada y transcrita."
            : "Graba la consulta para que Athos redacte la nota."}
        </span>
        <HelpTip>
          Antes de grabar se pide el <b>consentimiento del titular</b> (Ley 1581). El audio se
          transcribe y Athos redacta la nota SOAP; el audio se elimina a los 4 días.
        </HelpTip>
      </div>
      <Button onClick={beginFlow} variant={phase === "done" ? "outline" : "default"}>
        <Mic className="size-4" /> {phase === "done" ? "Grabar otra vez" : "Iniciar grabación"}
      </Button>
    </div>
  )
}

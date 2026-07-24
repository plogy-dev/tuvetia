"use client"

// Modo Fantasma — captura de la consulta.
// Flujo: consentimiento (Ley 1581, BLOQUEANTE) -> grabar -> subir al bucket privado
// -> registrar consultation_audios -> pedir transcripción (Deepgram) -> avisar al padre.
// Sin consentimiento no se habilita el micrófono; además la BD lo bloquea por trigger.

import { useCallback, useEffect, useRef, useState } from "react"
import { AudioLines, Loader2, Mic, ShieldCheck, Square } from "lucide-react"
import { toast } from "sonner"

import { athosTranscribe } from "@/lib/athos"
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
  patientName,
  onTranscribed,
}: {
  consultationId: string
  clinicId: string
  patientId: string
  patientName?: string
  onTranscribed?: () => void
}) {
  const [supabase] = useState(() => createClient())
  const [phase, setPhase] = useState<Phase>("idle")
  const [seconds, setSeconds] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // `handleStop` se engancha a rec.onstop al arrancar (cuando seconds=0), así que su closure
  // veía siempre 0 -> duration_secs quedaba en 0. El ref se lee al detener y está siempre al día.
  const secondsRef = useRef(0)

  // Limpieza: si el componente se desmonta grabando, soltamos el micrófono.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
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
      const rec = new MediaRecorder(stream, {
        mimeType: "audio/webm",
        audioBitsPerSecond: 48000,
      })
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
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
    try {
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
      await athosTranscribe({ consultationId, clinicId })
      setPhase("done")
      toast.success("Consulta transcrita. Ya puedes generar la nota.")
      onTranscribed?.()
    } catch (e) {
      toast.error(`No se pudo procesar la grabación: ${(e as Error).message}`)
      setPhase("idle")
    }
  }

  // 1) Consentimiento: se registra ANTES de tocar el micrófono.
  const acceptConsent = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      toast.error("Sesión no válida")
      return
    }
    const { error } = await supabase.from("consents").insert({
      clinic_id: clinicId,
      consultation_id: consultationId,
      patient_id: patientId,
      obtained_by: user.id,
      text_version: CONSENT_TEXT_VERSION,
      scope: CONSENT_SCOPE,
    })
    if (error) {
      toast.error(`No se pudo registrar el consentimiento: ${error.message}`)
      return
    }
    await startRecording()
  }, [supabase, clinicId, consultationId, patientId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- UI ----------
  if (phase === "consent") {
    return (
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-muted-foreground" /> Consentimiento del titular
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Vamos a grabar el audio de esta consulta{patientName ? ` de ${patientName}` : ""} para
          transcribirla y redactar la nota clínica. El audio se conserva 7 días y luego se elimina;
          la transcripción queda en la historia. Necesitamos la autorización del titular antes de
          empezar (Ley 1581 de 2012).
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="size-2 animate-pulse rounded-full bg-destructive" />
          <span className="font-medium">Grabando consulta</span>
          <span className="font-mono text-muted-foreground">{mmss}</span>
        </div>
        <Button variant="destructive" onClick={stopRecording}>
          <Square className="size-4" /> Detener y transcribir
        </Button>
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
          transcribe y Athos redacta la nota SOAP; el audio se elimina a los 7 días.
        </HelpTip>
      </div>
      <Button onClick={() => setPhase("consent")} variant={phase === "done" ? "outline" : "default"}>
        <Mic className="size-4" /> {phase === "done" ? "Grabar otra vez" : "Iniciar grabación"}
      </Button>
    </div>
  )
}

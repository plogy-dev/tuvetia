"use client"

// Historia de consultas del paciente — vista maestro-detalle: lista de consultas a la izquierda,
// detalle (audio + transcripción + nota) a la derecha. Permite eliminar la transcripción (RPC
// delete_transcript; borra solo el texto, el audio queda y se purga a los 7 días).

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, AudioLines, ExternalLink, FileText, Loader2, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { parseTranscript } from "@/lib/transcript"
import { ConsultationAudioPlayer } from "@/components/consultation-audio-player"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type NoteH = {
  id: string
  status: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  ai_model: string | null
  allergy_gate_triggered: boolean
}
type TranscriptH = { id: string; full_text: string | null; created_at: string }
type AudioH = { id: string; storage_path: string; duration_secs: number | null; created_at: string }
export type ConsultationHistory = {
  id: string
  status: string
  chief_complaint: string | null
  started_at: string
  transcripts: TranscriptH[] | null
  notes: NoteH[] | null
  audios: AudioH[] | null
}

const CONSULTATION_STATUS: Record<string, string> = {
  open: "Abierta",
  transcribing: "Transcribiendo",
  generating_note: "Generando nota",
  review: "En revisión",
  completed: "Completada",
}
const NOTE_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  draft: { label: "Borrador", variant: "secondary" },
  approved: { label: "Aprobada", variant: "default" },
  locked: { label: "Bloqueada", variant: "outline" },
}
const SOAP_FIELDS = [
  { key: "subjective", label: "Subjetivo" },
  { key: "objective", label: "Objetivo" },
  { key: "assessment", label: "Análisis" },
  { key: "plan", label: "Plan" },
] as const

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function latestTranscript(c: ConsultationHistory): TranscriptH | undefined {
  return [...(c.transcripts ?? [])].sort(
    (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
  )[0]
}

export function PatientConsultationHistory({
  consultations,
}: {
  consultations: ConsultationHistory[]
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [selectedId, setSelectedId] = useState<string | null>(consultations[0]?.id ?? null)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (consultations.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Este paciente todavía no tiene consultas registradas.
      </div>
    )
  }

  const selected = consultations.find((c) => c.id === selectedId) ?? consultations[0]
  const transcript = latestTranscript(selected)
  const note = selected.notes?.[0]
  const noteMeta = note ? NOTE_STATUS[note.status] : null
  const turns = parseTranscript(transcript?.full_text ?? "")
  const audios = selected.audios ?? []

  async function handleDelete() {
    if (!transcript) return
    setDeleting(true)
    const { error } = await supabase.rpc("delete_transcript", { p_id: transcript.id })
    setDeleting(false)
    setConfirming(false)
    if (error) {
      toast.error(`No se pudo eliminar la transcripción: ${error.message}`)
      return
    }
    toast.success("Transcripción eliminada")
    router.refresh()
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(200px,260px)_1fr] lg:items-start">
      {/* Maestro: lista de consultas */}
      <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto rounded-xl border bg-card p-1.5 lg:max-h-[70vh]">
        {consultations.map((c) => {
          const isSel = c.id === selected.id
          const cNoteMeta = c.notes?.[0] ? NOTE_STATUS[c.notes[0].status] : null
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setSelectedId(c.id)
                setConfirming(false)
              }}
              className={`flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${
                isSel ? "bg-primary/10" : "hover:bg-muted"
              }`}
            >
              <span className="text-sm font-medium">{fmtDate(c.started_at)}</span>
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {c.chief_complaint ?? "Consulta"}
              </span>
              {cNoteMeta && (
                <Badge variant={cNoteMeta.variant} className="mt-0.5 text-[10px]">
                  {cNoteMeta.label}
                </Badge>
              )}
            </button>
          )
        })}
      </div>

      {/* Detalle de la consulta seleccionada */}
      <div className="flex flex-col gap-4">
        {/* Cabecera */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3">
          <div>
            <div className="text-sm font-semibold">{fmtDate(selected.started_at)}</div>
            <div className="text-xs text-muted-foreground">
              {selected.chief_complaint ?? "Consulta"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {CONSULTATION_STATUS[selected.status] ?? selected.status}
            </Badge>
            {noteMeta && (
              <Badge variant={noteMeta.variant} className="text-xs">
                {noteMeta.label}
              </Badge>
            )}
            <Link
              href={`/dashboard/consultas/${selected.id}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Abrir <ExternalLink className="size-3" />
            </Link>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          {/* Transcripción + audio */}
          <div className="flex flex-col rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AudioLines className="size-4 text-muted-foreground" /> Transcripción
              </div>
              {transcript &&
                (confirming ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">¿Eliminar?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? <Loader2 className="size-3.5 animate-spin" /> : "Sí, eliminar"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={deleting}>
                      No
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirming(true)}
                  >
                    <Trash2 className="size-3.5" /> Eliminar
                  </Button>
                ))}
            </div>

            <div className="flex flex-col gap-3 p-4">
              {audios.length > 0 && (
                <div className="flex flex-col gap-2">
                  {audios.map((a) => (
                    <ConsultationAudioPlayer
                      key={a.id}
                      storagePath={a.storage_path}
                      durationSecs={a.duration_secs}
                    />
                  ))}
                </div>
              )}

              {turns.length === 0 ? (
                <p className="text-sm text-muted-foreground">Esta consulta no tiene transcripción.</p>
              ) : (
                <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                  {turns.map((t, i) => (
                    <div
                      key={i}
                      className={t.who === "vet" ? "flex flex-col items-end" : "flex flex-col items-start"}
                    >
                      <span className="mb-0.5 px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                        {t.who === "vet" ? "Veterinario" : "Titular"}
                      </span>
                      <div
                        className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${
                          t.who === "vet"
                            ? "rounded-br-sm bg-primary text-primary-foreground"
                            : "rounded-bl-sm border bg-background"
                        }`}
                      >
                        {t.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Nota clínica */}
          <div className="flex flex-col rounded-xl border bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold">
              <FileText className="size-4 text-muted-foreground" /> Nota clínica
            </div>
            <div className="flex flex-col gap-2.5 p-4">
              {!note ? (
                <p className="text-sm text-muted-foreground">Sin nota clínica para esta consulta.</p>
              ) : (
                <>
                  {note.allergy_gate_triggered && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>Gate de alergia severa activado en esta consulta.</span>
                    </div>
                  )}
                  {SOAP_FIELDS.map((f) => {
                    const value = note[f.key]
                    if (!value) return null
                    return (
                      <div key={f.key}>
                        <div className="text-xs font-medium text-muted-foreground">{f.label}</div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{value}</p>
                      </div>
                    )
                  })}
                  {note.ai_model && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Sparkles className="size-3" /> Redactada por {note.ai_model}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

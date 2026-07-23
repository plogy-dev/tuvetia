"use client"

import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  AudioLines,
  BookText,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Save,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { athosPhantomSuggest, type Citation, type ConditionAlert } from "@/lib/athos"
import { createClient } from "@/lib/supabase/client"
import { ConsultationRecorder } from "@/components/consultation-recorder"
import { SourceCard } from "@/components/athos/source-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type Soap = { subjective: string; objective: string; assessment: string; plan: string }

type Note = {
  id: string
  status: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  allergy_gate_triggered: boolean
  citations: Citation[] | null
  ai_model: string | null
  ai_generated_at: string | null
}

type Consultation = {
  id: string
  status: string
  chief_complaint: string | null
  clinic_id: string
  patient_id: string
  patient: { name: string; species: string } | null
}

const SOAP_FIELDS: { key: keyof Soap; label: string; hint: string }[] = [
  { key: "subjective", label: "Subjetivo", hint: "Motivo y relato del titular" },
  { key: "objective", label: "Objetivo", hint: "Hallazgos del examen físico" },
  { key: "assessment", label: "Análisis", hint: "Impresión — lenguaje de posibilidad" },
  { key: "plan", label: "Plan", hint: "Conducta y siguientes pasos" },
]

// Parte la transcripción en turnos (Vet / Dueño) para mostrarla como diálogo.
type Turn = { who: "vet" | "owner"; text: string }
function parseTranscript(text: string): Turn[] {
  if (!text) return []
  const turns: Turn[] = []
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(
      /^(veterinari[oa]|vet|m[ée]dic[oa]|due[nñ][oa]|due[nñ]a|propietari[oa]|cliente)\s*:\s*(.*)$/i,
    )
    if (m) {
      turns.push({ who: /vet|m[ée]dic/i.test(m[1]) ? "vet" : "owner", text: m[2] })
    } else {
      turns.push({ who: "owner", text: line })
    }
  }
  return turns
}

export default function NotaConsultaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [supabase] = useState(() => createClient())

  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [alerts, setAlerts] = useState<ConditionAlert[]>([])
  const [transcript, setTranscript] = useState<string>("")
  const [soap, setSoap] = useState<Soap>({ subjective: "", objective: "", assessment: "", plan: "" })

  const load = useCallback(async () => {
    const { data: c } = await supabase
      .from("consultations")
      .select("id, status, chief_complaint, clinic_id, patient_id, patient:patients(name, species)")
      .eq("id", id)
      .single()
    setConsultation(c as unknown as Consultation | null)

    const { data: t } = await supabase
      .from("transcripts")
      .select("full_text")
      .eq("consultation_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    setTranscript((t as { full_text: string | null } | null)?.full_text ?? "")

    const { data: n } = await supabase
      .from("clinical_notes")
      .select(
        "id, status, subjective, objective, assessment, plan, allergy_gate_triggered, citations, ai_model, ai_generated_at",
      )
      .eq("consultation_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (n) {
      const parsed = n as unknown as Note
      setNote(parsed)
      setSoap({
        subjective: parsed.subjective ?? "",
        objective: parsed.objective ?? "",
        assessment: parsed.assessment ?? "",
        plan: parsed.plan ?? "",
      })
      // Alertas de condición persistidas (migración 0004). Tolerante: si la columna aún no existe,
      // la query falla y conservamos lo que haya (p.ej. las del último suggest); no rompe la carga.
      const { data: al, error: alErr } = await supabase
        .from("clinical_notes")
        .select("alerts")
        .eq("id", parsed.id)
        .maybeSingle()
      const persisted = (al as { alerts?: ConditionAlert[] } | null)?.alerts
      if (!alErr && Array.isArray(persisted)) setAlerts(persisted)
    }
    setLoading(false)
  }, [supabase, id])

  useEffect(() => {
    load()
  }, [load])

  async function generate() {
    if (!consultation) return
    setGenerating(true)
    try {
      const res = await athosPhantomSuggest({ consultationId: id, clinicId: consultation.clinic_id })
      setAlerts(res.alerts ?? [])
      toast.success("Sugerencia generada por el Modo Fantasma")
      await load()
    } catch (e) {
      toast.error(`No se pudo generar la sugerencia: ${(e as Error).message}`)
    } finally {
      setGenerating(false)
    }
  }

  async function save() {
    if (!note) return
    setSaving(true)
    const { error } = await supabase
      .from("clinical_notes")
      .update({ ...soap, updated_at: new Date().toISOString() })
      .eq("id", note.id)
    setSaving(false)
    if (error) toast.error(`No se pudo guardar: ${error.message}`)
    else toast.success("Cambios guardados")
  }

  async function approve() {
    if (!note) return
    setApproving(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await supabase
      .from("clinical_notes")
      .update({
        ...soap,
        status: "approved",
        approved_by: user?.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", note.id)
    setApproving(false)
    if (error) {
      toast.error(`No se pudo aprobar: ${error.message}`)
      return
    }
    toast.success("Nota aprobada y añadida a la historia clínica")
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-16 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando consulta…
      </div>
    )
  }

  const approved = note?.status === "approved"
  const citations = note?.citations ?? []
  const turns = parseTranscript(transcript)
  const pet = consultation?.patient
  const initial = (pet?.name ?? "?").charAt(0).toUpperCase()

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-5 md:py-6 lg:px-6">
      <Link
        href="/dashboard/consultas"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Volver a consultas
      </Link>

      {/* Barra de sesión */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-sm font-semibold">
            {initial}
          </div>
          <div>
            <div className="text-sm font-semibold">
              {pet?.name ?? "Consulta"}
              {pet?.species && (
                <span className="ml-2 font-normal text-muted-foreground">{pet.species}</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {consultation?.chief_complaint ?? "Consulta"}
            </div>
          </div>
        </div>
        <Badge variant={approved ? "default" : "secondary"} className="gap-1.5">
          <span className={`size-1.5 rounded-full ${approved ? "bg-current" : "bg-current opacity-60"}`} />
          {note ? (approved ? "Aprobada" : "Borrador") : "Sin nota"}
        </Badge>
      </div>

      {/* Gate de alergia severa */}
      {note?.allergy_gate_triggered && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Gate de alergia severa activado.</strong> El paciente tiene una alergia severa
            registrada. Verifica el plan antes de aprobar.
          </span>
        </div>
      )}

      {/* Alertas de condición relevantes (no bloqueantes; panel "afectaciones en este paciente") */}
      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {alerts.map((a, i) => (
            <details
              key={`${a.condition}-${i}`}
              className="group rounded-lg border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2.5 p-3 text-sm">
                <Activity className="size-4 shrink-0" />
                <span className="text-[10px] font-semibold tracking-wide uppercase opacity-70">
                  Condición relevante
                </span>
                <span className="font-medium">{a.condition}</span>
                {a.detail && (
                  <span className="ml-auto flex items-center gap-1 text-xs font-medium opacity-80">
                    Ver afectaciones
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                  </span>
                )}
              </summary>
              {a.detail && (
                <div className="border-t border-amber-300/60 px-3 py-2.5 text-sm leading-relaxed dark:border-amber-900/50">
                  {a.detail}
                </div>
              )}
            </details>
          ))}
        </div>
      )}

      {/* Captura de la consulta (consentimiento -> grabar -> transcribir) */}
      {consultation && !approved && (
        <ConsultationRecorder
          consultationId={id}
          clinicId={consultation.clinic_id}
          patientId={consultation.patient_id}
          patientName={pet?.name}
          onTranscribed={load}
        />
      )}

      {/* Dos columnas: transcripción | nota clínica */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* Transcripción */}
        <div className="flex flex-col rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AudioLines className="size-4 text-muted-foreground" /> Transcripción
            </div>
            <Badge variant="outline" className="text-xs">
              Consulta
            </Badge>
          </div>
          <div className="flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto p-4">
            {turns.length === 0 && (
              <p className="text-sm text-muted-foreground">Esta consulta no tiene transcripción.</p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.who === "vet" ? "flex flex-col items-end" : "flex flex-col items-start"}>
                <span className="mb-0.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
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
        </div>

        {/* Nota clínica */}
        <div className="flex flex-col rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-muted-foreground" /> Nota clínica
            </div>
            {note && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Sparkles className="size-3" /> Athos redacta · borrador
              </Badge>
            )}
          </div>

          {!note ? (
            <div className="flex flex-col items-center gap-4 px-4 py-14 text-center">
              <Sparkles className="size-8 text-muted-foreground" />
              <div>
                <p className="font-medium">Aún no hay nota para esta consulta</p>
                <p className="text-sm text-muted-foreground">
                  Genera una sugerencia SOAP con literatura veterinaria citada a partir de la
                  transcripción.
                </p>
              </div>
              <Button onClick={generate} disabled={generating}>
                {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Generar sugerencia (Modo Fantasma)
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-4">
              {SOAP_FIELDS.map((f) => (
                <div key={f.key}>
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-sm font-medium">{f.label}</span>
                    <span className="text-xs text-muted-foreground">{f.hint}</span>
                  </div>
                  <Textarea
                    value={soap[f.key]}
                    onChange={(e) => setSoap((s) => ({ ...s, [f.key]: e.target.value }))}
                    disabled={approved}
                    rows={f.key === "assessment" || f.key === "plan" ? 4 : 2}
                  />
                </div>
              ))}

              <p className="text-xs text-muted-foreground">
                Se guardará en la ficha de <b className="text-foreground">{pet?.name}</b> cuando
                apruebes. Ninguna nota entra a la historia sin tu aprobación.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={save} disabled={saving || approved}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Guardar cambios
                </Button>
                <Button onClick={approve} disabled={approving || approved}>
                  {approving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  {approved ? "Nota aprobada" : "Revisar y aprobar"}
                </Button>
                {note.ai_model && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Redactada por {note.ai_model}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fuentes citadas */}
      {note && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BookText className="size-4 text-muted-foreground" /> Fuentes citadas ({citations.length})
          </div>
          {citations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin evidencia suficiente: esta nota no cita literatura (Athos se abstiene antes que
              inventar una fuente).
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {citations.map((c, i) => (
                <SourceCard key={`${c.chunk_id}-${i}`} c={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

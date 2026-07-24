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
import { parseTranscript } from "@/lib/transcript"
import { ConsultationRecorder } from "@/components/consultation-recorder"
import { HelpTip } from "@/components/help-tip"
import { SourceCard } from "@/components/athos/source-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"

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

export default function NotaConsultaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [supabase] = useState(() => createClient())

  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [gateAck, setGateAck] = useState(false)
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [alerts, setAlerts] = useState<ConditionAlert[]>([])
  const [transcript, setTranscript] = useState<string>("")
  const [soap, setSoap] = useState<Soap>({ subjective: "", objective: "", assessment: "", plan: "" })

  const load = useCallback(async () => {
    const { data: c, error: cErr } = await supabase
      .from("consultations")
      .select("id, status, chief_complaint, clinic_id, patient_id, patient:patients(name, species)")
      .eq("id", id)
      .single()
    // Si la consulta no carga (RLS, id inexistente, columna renombrada), `consultation` queda null y
    // no se monta el grabador ni nada que dependa de ella. Sin esto, el fallo es silencioso.
    if (cErr) console.error("No se pudo cargar la consulta:", cErr)
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
    // load() es async: todos sus setState ocurren después de awaits (nunca síncronos en el effect).
    // El compilador de React no traza a través del async y lo marca igual — falso positivo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function generate() {
    if (!consultation) return
    setGenerating(true)
    try {
      const res = await athosPhantomSuggest({ consultationId: id, clinicId: consultation.clinic_id })
      setAlerts(res.alerts ?? [])
      // La sugerencia está lista para la revisión del vet -> avanza el estado de la consulta.
      await supabase
        .from("consultations")
        .update({ status: "review", updated_at: new Date().toISOString() })
        .eq("id", id)
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
    // Gate de alergia severa: bloqueante. No se aprueba hasta que el vet confirme que revisó el plan.
    if (note.allergy_gate_triggered && !gateAck) {
      toast.error("Confirma que revisaste la alergia severa antes de aprobar la nota.")
      return
    }
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
    if (error) {
      setApproving(false)
      toast.error(`No se pudo aprobar: ${error.message}`)
      return
    }
    // Cierra el ciclo: la nota entró a la historia -> consulta 'completed'.
    // (open->transcribing->generating_note lo pone el backend en /athos/transcribe;
    //  aquí nuestro flujo del Phantom la lleva a 'completed' al aprobar. Ver seam en la bitácora.)
    await supabase
      .from("consultations")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
    setApproving(false)
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

      {/* Cabecera del paciente */}
      <div className="rounded-xl border bg-card p-4 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-xl font-bold">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
              {pet?.name ?? "Consulta"}
            </h1>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {pet?.species && <span className="font-medium text-foreground">{pet.species}</span>}
              <span>{consultation?.chief_complaint ?? "Consulta"}</span>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2.5 py-1 text-xs font-medium">
            <span className={`size-1.5 rounded-full ${approved ? "bg-foreground" : "bg-muted-foreground"}`} />
            {note ? (approved ? "Aprobada" : "Borrador — requiere aprobación") : "Sin nota"}
          </span>
          {note?.ai_model && (
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              Motor IA <span className="font-mono text-foreground">{note.ai_model}</span>
            </span>
          )}
          {note && (
            <span className="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground" />
              {citations.length > 0 ? "Evidencia suficiente" : "Sin literatura citada"}
            </span>
          )}
        </div>
      </div>

      {/* Alertas de la consulta: gate de alergia (bloqueante) + condiciones relevantes */}
      {(note?.allergy_gate_triggered || alerts.length > 0) && (
        <section className="rounded-xl border bg-card p-4 shadow-sm md:p-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
            Alertas de la consulta
          </p>
          <div className="flex flex-col gap-3">
            {/* Gate de alergia severa — CRÍTICO, bloquea la aprobación */}
            {note?.allergy_gate_triggered && (
              <details open className="group overflow-hidden rounded-lg border border-destructive/40 bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-3 border-l-4 border-l-destructive bg-destructive/10 p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-destructive text-destructive-foreground">
                    <AlertTriangle className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-destructive">
                      Alergia severa · bloqueante
                    </span>
                    <span className="block font-semibold">Alergia severa registrada — revisa antes del plan</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
                    Ver
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="border-t p-4 text-sm leading-relaxed">
                  <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Fuente: ficha del paciente (determinístico, no del modelo)
                  </p>
                  <p>
                    <span className="mr-1.5 rounded bg-secondary px-2 py-0.5 text-[11px] font-bold uppercase text-foreground">
                      En {pet?.name ?? "este paciente"}
                    </span>
                    Hay una <strong>alergia severa</strong> registrada en su historia. Evita el fármaco
                    implicado y su clase en cualquier plan. Esta alerta <strong>bloquea la aprobación</strong> de
                    la nota hasta tu revisión.
                  </p>
                  {!approved && (
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-medium">
                      <Checkbox
                        checked={gateAck}
                        onCheckedChange={(checked) => setGateAck(checked === true)}
                      />
                      Confirmo que revisé el plan considerando esta alergia severa
                    </label>
                  )}
                </div>
              </details>
            )}

            {/* Condiciones relevantes — no bloqueantes, panel "afectaciones en este paciente" */}
            {alerts.map((a, i) => (
              <details key={`${a.condition}-${i}`} className="group overflow-hidden rounded-lg border bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-3 border-l-4 border-l-muted-foreground bg-secondary p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                    <Activity className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Condición relevante
                    </span>
                    <span className="block font-semibold">{a.condition}</span>
                  </span>
                  {a.detail && (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
                      Ver afectaciones
                      <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                    </span>
                  )}
                </summary>
                {a.detail && (
                  <div className="border-t p-4 text-sm leading-relaxed">
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Explicación generada · anclada a la literatura recuperada
                    </p>
                    <p>
                      <span className="mr-1.5 rounded bg-secondary px-2 py-0.5 text-[11px] font-bold uppercase text-foreground">
                        En {pet?.name ?? "este paciente"}
                      </span>
                      {a.detail}
                    </p>
                  </div>
                )}
              </details>
            ))}
          </div>
        </section>
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
              <HelpTip>
                Athos redacta la nota SOAP a partir de la transcripción, con literatura veterinaria
                citada y verificable. Es un <b>borrador</b>: revisala, editala y aprobala — nada entra
                a la historia sin tu aprobación.
              </HelpTip>
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
                <div key={f.key} className="flex gap-3">
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border bg-secondary text-sm font-bold">
                    {f.label.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {f.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{f.hint}</span>
                    </div>
                    <Textarea
                      value={soap[f.key]}
                      onChange={(e) => setSoap((s) => ({ ...s, [f.key]: e.target.value }))}
                      disabled={approved}
                      rows={f.key === "assessment" || f.key === "plan" ? 4 : 2}
                    />
                  </div>
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
                <Button
                  onClick={approve}
                  disabled={
                    approving ||
                    approved ||
                    (note.allergy_gate_triggered && !gateAck)
                  }
                >
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

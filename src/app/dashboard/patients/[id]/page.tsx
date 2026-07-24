import Link from "next/link"
import { notFound } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  AudioLines,
  CalendarDays,
  FileText,
  PawPrint,
  Pill,
  Sparkles,
  Syringe,
} from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { parseTranscript } from "@/lib/transcript"
import { ConsultationAudioPlayer } from "@/components/consultation-audio-player"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"

const SEX_LABELS: Record<string, string> = {
  male: "Macho",
  female: "Hembra",
  unknown: "Sexo desconocido",
}

const SEVERITY_LABELS: Record<string, string> = {
  mild: "leve",
  moderate: "moderada",
  severe: "severa",
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

type Owner = { full_name: string; phone: string | null } | null

type Patient = {
  id: string
  name: string
  species: string
  breed: string | null
  sex: string
  birth_date: string | null
  weight_kg: number | null
  color: string | null
  photo_url: string | null
  is_deceased: boolean
  notes: string | null
  owner: Owner
}

type Allergy = { id: string; allergen: string; severity: string; reaction: string | null }
type Medication = { id: string; drug_name: string; dose: string; frequency: string | null; is_chronic: boolean; end_date: string | null }
type Vaccine = { id: string; vaccine_name: string; administered_at: string; next_dose_at: string | null }

type Note = {
  id: string
  status: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  ai_model: string | null
  allergy_gate_triggered: boolean
}
type Transcript = { id: string; full_text: string | null; created_at: string }
type Audio = { id: string; storage_path: string; duration_secs: number | null; created_at: string }
type Consultation = {
  id: string
  status: string
  chief_complaint: string | null
  started_at: string
  transcripts: Transcript[] | null
  notes: Note[] | null
  audios: Audio[] | null
}

const DATE_FMT: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("es-CO", DATE_FMT)
}

function fmtAge(birth: string | null): string | null {
  if (!birth) return null
  const b = new Date(birth)
  const now = new Date()
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth())
  if (now.getDate() < b.getDate()) months -= 1
  if (months < 0) return null
  const years = Math.floor(months / 12)
  const rem = months % 12
  if (years === 0) return `${rem} ${rem === 1 ? "mes" : "meses"}`
  if (rem === 0) return `${years} ${years === 1 ? "año" : "años"}`
  return `${years} a ${rem} m`
}

export default async function PatientHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: p } = await supabase
    .from("patients")
    .select(
      "id, name, species, breed, sex, birth_date, weight_kg, color, photo_url, is_deceased, notes, owner:owners(full_name, phone)",
    )
    .eq("id", id)
    .maybeSingle()
  const patient = p as unknown as Patient | null
  if (!patient) notFound()

  const [{ data: allergyData }, { data: medData }, { data: vaxData }, { data: consultData }] =
    await Promise.all([
      supabase.from("allergies").select("id, allergen, severity, reaction").eq("patient_id", id),
      supabase
        .from("medications")
        .select("id, drug_name, dose, frequency, is_chronic, end_date")
        .eq("patient_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("vaccines")
        .select("id, vaccine_name, administered_at, next_dose_at")
        .eq("patient_id", id)
        .order("administered_at", { ascending: false }),
      supabase
        .from("consultations")
        .select(
          "id, status, chief_complaint, started_at, " +
            "transcripts:transcripts(id, full_text, created_at), " +
            "notes:clinical_notes(id, status, subjective, objective, assessment, plan, ai_model, allergy_gate_triggered), " +
            "audios:consultation_audios(id, storage_path, duration_secs, created_at)",
        )
        .eq("patient_id", id)
        .order("started_at", { ascending: false }),
    ])

  const allergies = (allergyData as unknown as Allergy[] | null) ?? []
  const medications = (medData as unknown as Medication[] | null) ?? []
  const vaccines = (vaxData as unknown as Vaccine[] | null) ?? []
  const consultations = (consultData as unknown as Consultation[] | null) ?? []
  const severeAllergies = allergies.filter((a) => a.severity === "severe")

  const initial = patient.name.charAt(0).toUpperCase()
  const age = fmtAge(patient.birth_date)
  const meta = [
    patient.species,
    patient.breed,
    SEX_LABELS[patient.sex] ?? patient.sex,
    age,
    patient.weight_kg ? `${patient.weight_kg} kg` : null,
    patient.color,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-5 md:py-6 lg:px-6">
      <Link
        href="/dashboard/patients"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Volver a pacientes
      </Link>

      {/* Ficha del paciente */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4">
        <Avatar className="size-14">
          <AvatarImage src={patient.photo_url ?? undefined} alt={patient.name} />
          <AvatarFallback className="text-lg font-semibold">{initial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{patient.name}</h1>
            {patient.is_deceased && <Badge variant="outline">Fallecido</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{meta.join(" · ")}</p>
          {patient.owner && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Titular: <span className="text-foreground">{patient.owner.full_name}</span>
              {patient.owner.phone ? ` · ${patient.owner.phone}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Alergias severas — gate clínico */}
      {severeAllergies.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Alergia severa:</strong> {severeAllergies.map((a) => a.allergen).join(", ")}.
            Verifica el plan antes de cualquier tratamiento.
          </span>
        </div>
      )}

      {/* Resumen clínico: alergias / medicación / vacunas */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 text-muted-foreground" /> Alergias
          </div>
          {allergies.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin alergias registradas.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {allergies.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span
                    className={`size-1.5 rounded-full ${a.severity === "severe" ? "bg-destructive" : "bg-muted-foreground/50"}`}
                  />
                  <span className="font-medium">{a.allergen}</span>
                  <span className="text-muted-foreground">{SEVERITY_LABELS[a.severity] ?? a.severity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Pill className="size-4 text-muted-foreground" /> Medicación
          </div>
          {medications.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin medicación registrada.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {medications.slice(0, 6).map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{m.drug_name}</span>
                  <span className="text-muted-foreground">{m.dose}</span>
                  {m.is_chronic && <Badge variant="outline" className="text-[10px]">Crónico</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Syringe className="size-4 text-muted-foreground" /> Vacunas
          </div>
          {vaccines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin vacunas registradas.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {vaccines.slice(0, 6).map((v) => (
                <li key={v.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{v.vaccine_name}</span>
                  <span className="text-muted-foreground">{fmtDate(v.administered_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Línea de tiempo de consultas: transcripción + audio + nota */}
      <div className="flex items-center gap-2 pt-1">
        <CalendarDays className="size-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">Historia de consultas ({consultations.length})</h2>
      </div>

      {consultations.length === 0 && (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Este paciente todavía no tiene consultas registradas.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {consultations.map((c) => {
          const transcript = [...(c.transcripts ?? [])].sort(
            (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
          )[0]
          const note = [...(c.notes ?? [])][0]
          const noteMeta = note ? NOTE_STATUS[note.status] : null
          const turns = parseTranscript(transcript?.full_text ?? "")
          const audios = c.audios ?? []

          return (
            <div key={c.id} className="overflow-hidden rounded-xl border bg-card">
              {/* Cabecera de la consulta */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{fmtDate(c.started_at)}</span>
                  <span className="text-muted-foreground">
                    · {c.chief_complaint ?? "Consulta"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {CONSULTATION_STATUS[c.status] ?? c.status}
                  </Badge>
                  {noteMeta && <Badge variant={noteMeta.variant} className="text-xs">{noteMeta.label}</Badge>}
                  <Link
                    href={`/dashboard/consultas/${c.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Abrir
                  </Link>
                </div>
              </div>

              <div className="grid gap-4 p-4 lg:grid-cols-2 lg:items-start">
                {/* Transcripción + audio */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <AudioLines className="size-4 text-muted-foreground" /> Transcripción
                  </div>

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
                    <p className="text-sm text-muted-foreground">
                      Esta consulta no tiene transcripción.
                    </p>
                  ) : (
                    <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                      {turns.map((t, i) => (
                        <div
                          key={i}
                          className={t.who === "vet" ? "flex flex-col items-end" : "flex flex-col items-start"}
                        >
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
                  )}
                </div>

                {/* Nota clínica */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <FileText className="size-4 text-muted-foreground" /> Nota clínica
                  </div>
                  {!note ? (
                    <p className="text-sm text-muted-foreground">
                      Sin nota clínica para esta consulta.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2.5">
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
                            <p className="whitespace-pre-wrap text-sm leading-relaxed">{value}</p>
                          </div>
                        )
                      })}
                      {note.ai_model && (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Sparkles className="size-3" /> Redactada por {note.ai_model}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {patient.notes && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <PawPrint className="size-4 text-muted-foreground" /> Notas del paciente
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{patient.notes}</p>
        </div>
      )}
    </div>
  )
}

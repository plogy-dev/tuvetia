import Link from "next/link"
import { notFound } from "next/navigation"
import { AlertTriangle, ArrowLeft, CalendarDays, PawPrint, Stethoscope } from "lucide-react"

import { fmtAgeLong } from "@/lib/age"
import { createClient } from "@/lib/supabase/server"
import {
  PatientAttachments,
  type PatientAttachment,
} from "@/components/patient/patient-attachments"
import {
  PatientConsultationHistory,
  type ConsultationHistory,
} from "@/components/patient/patient-consultation-history"
import {
  PatientAppointments,
  type PatientAppointment,
} from "@/components/patient/patient-appointments"
import {
  PatientClinicalSummary,
  type Allergy,
  type Medication,
  type Vaccine,
} from "@/components/patient/patient-clinical-summary"
import { EditarPacienteDrawer } from "@/components/patient/editar-paciente-drawer"
import { PlanDelPacienteCard } from "@/components/planes-salud/plan-del-paciente"
import { listarPlanes, planDelPaciente } from "@/lib/planes-salud/consultas"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"

export const metadata = { title: "Paciente · Tuvetia" }


const SEX_LABELS: Record<string, string> = {
  male: "Macho",
  female: "Hembra",
  unknown: "Sexo desconocido",
}

type Owner = { full_name: string; phone: string | null } | null

type Patient = {
  id: string
  clinic_id: string
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
  /** Para enlazar a la ficha del titular; el embed `owner` sólo trae su nombre y teléfono. */
  owner_id: string | null
  owner: Owner
}

export default async function PatientHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: p } = await supabase
    .from("patients")
    .select(
      "id, clinic_id, name, species, breed, sex, birth_date, weight_kg, color, photo_url, is_deceased, notes, owner_id, owner:owners(full_name, phone)",
    )
    .eq("id", id)
    .maybeSingle()
  const patient = p as unknown as Patient | null
  if (!patient) notFound()

  const [
    { data: allergyData },
    { data: medData },
    { data: vaxData },
    { data: consultData },
    { data: attachData },
    { data: apptData, error: apptError },
    planActual,
    planesDisponibles,
    { data: quienMira },
  ] = await Promise.all([
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
            // Solo metadata de transcripts: el full_text lo trae on-demand el componente de
            // historia al seleccionar (pacientes con historia larga bajaban TODOS los textos).
            "transcripts:transcripts(id, created_at), " +
            "notes:clinical_notes(id, status, subjective, objective, assessment, plan, ai_generated_at, allergy_gate_triggered), " +
            "audios:consultation_audios(id, storage_path, duration_secs, created_at)",
        )
        .eq("patient_id", id)
        .order("started_at", { ascending: false })
        // notes[0] = la más reciente (sin esto PostgREST no garantiza orden del embed)
        .order("created_at", { referencedTable: "notes", ascending: false }),
      supabase
        .from("patient_attachments")
        .select("id, label, file_url, file_type, file_size, created_at")
        .eq("patient_id", id)
        .order("created_at", { ascending: false }),
      // Citas del paciente: las próximas primero, después la historia hacia atrás.
      //
      // El `!appointments_vet_id_fkey` NO es decoración: `appointments` tiene TRES claves foráneas a
      // `profiles` —`vet_id`, `created_by` y `calendar_owner_id` (esta última de la 0049)—, así que
      // un `vet:profiles(...)` a secas es ambiguo y PostgREST responde PGRST201 en vez de datos.
      // Sin el hint esta sección mostraba "Citas (0)" para todos los pacientes. Mismo estilo que
      // `lib/facturacion/queries.ts`.
      supabase
        .from("appointments")
        .select("id, title, reason, status, starts_at, vet:profiles!appointments_vet_id_fkey(full_name)")
        .eq("patient_id", id)
        .order("starts_at", { ascending: false })
        .limit(50),
        // El plan del paciente, los planes que la clínica ofrece hoy, y si quien mira puede
      // contratar. Van en la MISMA ola que el resto: son tres lecturas chicas y encadenarlas
      // después le sumaría un viaje a una ficha que ya hace seis.
      planDelPaciente(supabase, patient.clinic_id, id),
      listarPlanes(supabase, patient.clinic_id),
      supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle(),
  ])

  // Un embed ambiguo devuelve `error` y `data: null`, y sin mirarlo el `?? []` de abajo lo convierte
  // en "este paciente no tiene citas". Es indistinguible de la verdad, y así pasó desapercibido.
  if (apptError) console.error("[ficha] no se pudieron cargar las citas:", apptError.message)

  const allergies = (allergyData as unknown as Allergy[] | null) ?? []
  const medications = (medData as unknown as Medication[] | null) ?? []
  const vaccines = (vaxData as unknown as Vaccine[] | null) ?? []
  const consultations = (consultData as unknown as ConsultationHistory[] | null) ?? []
  const attachments = (attachData as unknown as PatientAttachment[] | null) ?? []
  const appointments = (apptData as unknown as PatientAppointment[] | null) ?? []
  const severeAllergies = allergies.filter((a) => a.severity === "severe")

  const initial = patient.name.charAt(0).toUpperCase()
  const age = fmtAgeLong(patient.birth_date)
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
            {/* Hasta hoy un error de tipeo en el nombre quedaba para siempre: `patients` no tenía
                ninguna ruta de UPDATE en el producto. */}
            <EditarPacienteDrawer
              patientId={patient.id}
              ownerId={patient.owner_id}
              inicial={{
                name: patient.name,
                species: patient.species,
                breed: patient.breed ?? "",
                sex: patient.sex,
                birthDate: patient.birth_date ?? "",
                weightKg: patient.weight_kg != null ? String(patient.weight_kg) : "",
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">{meta.join(" · ")}</p>
          {patient.owner && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Titular:{" "}
              {/* Enlace a la ficha del titular: es donde viven su documento, su correo, el
                  consentimiento de grabación y sus OTRAS mascotas. Antes era texto muerto. */}
              {patient.owner_id ? (
                <Link
                  href={`/dashboard/owners/${patient.owner_id}`}
                  className="text-foreground hover:underline"
                >
                  {patient.owner.full_name}
                </Link>
              ) : (
                <span className="text-foreground">{patient.owner.full_name}</span>
              )}
              {patient.owner.phone ? ` · ${patient.owner.phone}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Alergias severas — gate clínico */}
      {severeAllergies.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-danger-soft px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Alergia severa:</strong> {severeAllergies.map((a) => a.allergen).join(", ")}.
            Verifica el plan antes de cualquier tratamiento.
          </span>
        </div>
      )}

      {/* Resumen clínico: alergias / medicación / vacunas.
          Antes las tres tarjetas se ocultaban al estar vacías, porque no había ninguna ruta de
          escritura por UI y tres cajas que nunca se pueden llenar son tres callejones sin salida.
          Medicación y vacunas YA tienen alta (las policies de INSERT existían; faltaba la
          interfaz), así que ahora se pintan siempre. El detalle vive en el componente. */}
      <PatientClinicalSummary
        clinicId={patient.clinic_id}
        patientId={patient.id}
        allergies={allergies}
        medications={medications}
        vaccines={vaccines}
      />

      {/* El plan de salud del paciente: qué cubre y qué le queda. Va junto al resumen clínico
          porque es lo mismo que el resumen responde —qué tiene este animal— sólo que en plata. */}
      <PlanDelPacienteCard
        patientId={patient.id}
        plan={planActual}
        planesDisponibles={planesDisponibles.map((pl) => ({
          id: pl.id,
          name: pl.name,
          price_cents: pl.price_cents,
          months: pl.months,
        }))}
        puedeContratar={(quienMira as { role: string | null } | null)?.role === "admin"}
      />

      {/* Archivos adjuntos: exámenes médicos, radiografías, laboratorio… */}
      <PatientAttachments
        clinicId={patient.clinic_id}
        patientId={patient.id}
        attachments={attachments}
      />

      {/* Citas agendadas: el registro de cuándo vino y cuándo vuelve. Solo lectura. */}
      <div className="flex items-center gap-2 pt-1">
        <CalendarDays className="size-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">Citas ({appointments.length})</h2>
      </div>

      <PatientAppointments appointments={appointments} nowIso={new Date().toISOString()} />

      {/* Historia de consultas: maestro-detalle (transcripción + audio + nota) */}
      <div className="flex items-center gap-2 pt-1">
        <Stethoscope className="size-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">Historia de consultas ({consultations.length})</h2>
      </div>

      <PatientConsultationHistory consultations={consultations} />

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

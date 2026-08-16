import Link from "next/link"
import { UploadIcon } from "lucide-react"

import { CreatePatientDrawer } from "@/components/create-patient-drawer"
import { HelpTip } from "@/components/help-tip"
import { PatientsExplorer, type PatientRow } from "@/components/patients-explorer"
import { Button } from "@/components/ui/button"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { VistaPacientesTitulares } from "@/components/patients/vista-pacientes-titulares"
import { StatCard } from "@/components/ui/stat-card"
import { createClient } from "@/lib/supabase/server"

// Límites del día y del mes en hora de Colombia (UTC-5, sin DST) para las métricas.
function bogotaBounds() {
  const BOG = 5 * 3600e3
  const bogNow = new Date(Date.now() - BOG)
  const dayStart = new Date(
    Date.UTC(bogNow.getUTCFullYear(), bogNow.getUTCMonth(), bogNow.getUTCDate()) + BOG
  )
  return {
    dayStart,
    dayEnd: new Date(dayStart.getTime() + 24 * 3600e3),
    monthStart: new Date(Date.UTC(bogNow.getUTCFullYear(), bogNow.getUTCMonth(), 1) + BOG),
  }
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const supabase = await createClient()
  const { q: initialQuery } = await searchParams

  const { dayStart, dayEnd, monthStart } = bogotaBounds()

  // Guarda de escala: listado acotado; con más pacientes se busca por nombre (paginación real: backlog).
  // La búsqueda y el filtro por especie son client-side (PatientsExplorer): estas queries corren UNA
  // vez por visita, no una vez por tecla.
  const [{ data, error: listError }, activos, citasHoy, enRevision, nuevosMes] = await Promise.all([
    supabase
      .from("patients")
      .select(
        // `allergies` se embebe para poder marcar la alerta EN EL LISTADO. Es la idea del mockup y
        // la única de esta pasada que evita un daño real: que "Luna" diga *Alergias* antes de abrir
        // la ficha es lo que frena una prescripción equivocada. Un embed to-many sobre 200 filas,
        // acotado a lo mínimo (severidad y alérgeno) — no trae la reacción ni quién la registró.
        "id, name, species, breed, sex, birth_date, photo_url, owner:owners(full_name, phone), allergies(allergen, severity)"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("patients").select("*", { count: "exact", head: true }),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString()),
    supabase
      .from("consultations")
      .select("*", { count: "exact", head: true })
      .eq("status", "review"),
    supabase
      .from("patients")
      .select("*", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString()),
  ])
  const all = (data as unknown as PatientRow[] | null) ?? []

  const metrics = [
    { n: activos.count ?? 0, l: "Pacientes activos" },
    { n: citasHoy.count ?? 0, l: "Citas hoy" },
    { n: enRevision.count ?? 0, l: "Consultas en revisión" },
    { n: nuevosMes.count ?? 0, l: "Nuevos del mes" },
  ]

  return (
    <PageShell>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Pacientes
            <HelpTip side="right">
              La ficha de cada paciente guarda su historia clínica completa: consultas con
              transcripción y audio, alergias, vacunas y medicación. Usa el botón <b>Historia</b>{" "}
              para verla.
            </HelpTip>
          </span>
        }
        description={`${activos.count ?? 0} ${
          (activos.count ?? 0) === 1 ? "paciente activo" : "pacientes activos"
        }`}
        actions={
          <>
            <Button variant="outline" render={<Link href="/dashboard/patients/import" />}>
              <UploadIcon className="size-4" /> Importar
            </Button>
            <CreatePatientDrawer label="Nuevo paciente" trigger={<Button />} />
          </>
        }
      />

      <VistaPacientesTitulares activa="/dashboard/patients" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <StatCard key={m.l} label={m.l} value={String(m.n)} />
        ))}
      </div>

      <PatientsExplorer
        rows={all}
        listError={Boolean(listError)}
        initialQuery={initialQuery ?? ""}
      />
    </PageShell>
  )
}

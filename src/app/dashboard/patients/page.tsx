import Link from "next/link"
import { PlusIcon, UploadIcon } from "lucide-react"

import { CreatePatientDrawer } from "@/components/create-patient-drawer"
import { HelpTip } from "@/components/help-tip"
import { PatientsExplorer, type PatientRow } from "@/components/patients-explorer"
import { Button } from "@/components/ui/button"
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

export default async function PatientsPage() {
  const supabase = await createClient()

  const { dayStart, dayEnd, monthStart } = bogotaBounds()

  // Guarda de escala: listado acotado; con más pacientes se busca por nombre (paginación real: backlog).
  // La búsqueda y el filtro por especie son client-side (PatientsExplorer): estas queries corren UNA
  // vez por visita, no una vez por tecla.
  const [{ data, error: listError }, activos, citasHoy, enRevision, nuevosMes] = await Promise.all([
    supabase
      .from("patients")
      .select(
        "id, name, species, breed, sex, birth_date, photo_url, owner:owners(full_name, phone)"
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
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      {/* Encabezado + acciones */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">Pacientes</h1>
            <HelpTip side="right">
              La ficha de cada paciente guarda su historia clínica completa: consultas con
              transcripción y audio, alergias, vacunas y medicación. Usa el botón{" "}
              <b>Historia</b> para verla.
            </HelpTip>
          </div>
          <p className="text-sm text-muted-foreground">
            {activos.count ?? 0} {(activos.count ?? 0) === 1 ? "paciente activo" : "pacientes activos"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" render={<Link href="/dashboard/patients/import" />}>
            <UploadIcon className="size-4" /> Importar
          </Button>
          <CreatePatientDrawer
            label="Nuevo paciente"
            trigger={
              <Button size="sm">
                <PlusIcon className="size-4" />
              </Button>
            }
          />
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.l} className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-2xl font-semibold tracking-tight">{m.n}</div>
            <div className="text-xs text-muted-foreground">{m.l}</div>
          </div>
        ))}
      </div>

      <PatientsExplorer rows={all} listError={Boolean(listError)} />
    </div>
  )
}

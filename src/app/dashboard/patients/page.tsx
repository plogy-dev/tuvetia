import Link from "next/link"
import {
  PastillasDelTablero,
  type Pastilla,
} from "@/components/dashboard/pastillas-del-tablero"
import { UploadIcon } from "lucide-react"

import { CreatePatientDrawer } from "@/components/create-patient-drawer"
import { HelpTip } from "@/components/help-tip"
import { PatientsExplorer, type PatientRow } from "@/components/patients-explorer"
import { Button } from "@/components/ui/button"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { VistaPacientesTitulares } from "@/components/patients/vista-pacientes-titulares"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Pacientes · Tuvetia" }


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
    // `is_deceased` FALSE: la tarjeta dice "Pacientes activos" y contaba TODOS. Hoy no se nota
    // —no hay ninguno marcado— y el día que lo haya la cifra habría empezado a mentir sin que
    // nada fallara. El detalle de la vista rápida usa el mismo filtro.
    supabase.from("patients").select("*", { count: "exact", head: true }).eq("is_deceased", false),
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

  // LAS CUATRO CIFRAS, AHORA SE ABREN. Lo pidió Luciano el 19-ago para el tablero —"no que te full
  // redireccione, sino una vista más directa"— y vale igual acá: la pregunta que dispara una cifra
  // ("¿cuáles son esas nueve?") dura dos segundos, y salir de la pantalla cuesta perder de vista
  // todo lo demás.
  //
  // La `metrica` es la que responde `/api/tablero/detalle`, y sus filtros son COPIA de los conteos
  // de arriba. Hay un test que lo vigila: una tarjeta que dice 9 y una vista que muestra 11 es peor
  // que no tener la vista.
  const metrics: Pastilla[] = [
    { metrica: "pacientes-activos", label: "Pacientes activos", value: String(activos.count ?? 0), hint: "Sin contar los fallecidos" },
    { metrica: "citas-hoy", label: "Citas hoy", value: String(citasHoy.count ?? 0), hint: "Agendadas para hoy" },
    { metrica: "consultas-revision", label: "Consultas en revisión", value: String(enRevision.count ?? 0), hint: "Esperando que alguien las cierre" },
    { metrica: "pacientes-nuevos-mes", label: "Nuevos del mes", value: String(nuevosMes.count ?? 0), hint: "Dados de alta este mes" },
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

      <PastillasDelTablero
        pastillas={metrics}
        clase="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"
      />

      <PatientsExplorer
        rows={all}
        listError={Boolean(listError)}
        initialQuery={initialQuery ?? ""}
      />
    </PageShell>
  )
}

import { endOfWeek, startOfWeek } from "date-fns"

import { createClient } from "@/lib/supabase/server"
import { AppointmentCalendarLazy as AppointmentCalendar } from "@/components/calendar/appointment-calendar-lazy"
import { DataError } from "@/components/data-error"
import { APPOINTMENT_SELECT, type AppointmentRow, type PatientOption, type SelectOption } from "@/lib/appointments"

// La agenda de la clínica. `public.appointments` es la ÚNICA fuente de verdad: nada entra desde un
// calendario externo (calendario v3, migración 0049 — la sincronización es de una sola vía). Eso es
// lo que cierra el incidente del 2026-07-31, cuando el pull automático metió el calendario personal
// de un vet como citas de la clínica: hoy ese canal no existe.
//
// Conectar un calendario se hace desde /dashboard/conexiones, no acá: es una decisión de cada
// usuario (su propio calendario), no algo de la pantalla de agenda.

export default async function CalendarioPage() {
  const supabase = await createClient()

  // Rango inicial: semana actual (lun–dom). El cliente refetchea al navegar.
  const now = new Date()
  const rangeStart = startOfWeek(now, { weekStartsOn: 1 })
  const rangeEnd = endOfWeek(now, { weekStartsOn: 1 })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // clinic_id explícito para el selector de vets (defensa en profundidad, no solo RLS).
  const clinicId = user
    ? ((await supabase.from("profiles").select("clinic_id").eq("id", user.id).single()).data as
        | { clinic_id: string | null }
        | null)?.clinic_id ?? null
    : null

  const [{ data: appts, error: apptsError }, { data: pts }, { data: owns }, { data: profs }] =
    await Promise.all([
      supabase
        .from("appointments")
        .select(APPOINTMENT_SELECT)
        .lte("starts_at", rangeEnd.toISOString())
        .gte("ends_at", rangeStart.toISOString())
        .order("starts_at", { ascending: true }),
      // Guarda de escala: opciones de los selects del drawer acotadas (búsqueda tipada: backlog).
      // owner_id viaja para el autocompletado/bloqueo titular↔paciente del drawer.
      supabase.from("patients").select("id, name, owner_id").order("name").limit(1000),
      supabase.from("owners").select("id, full_name").order("full_name").limit(1000),
      clinicId
        ? supabase.from("profiles").select("id, full_name").eq("clinic_id", clinicId)
        : Promise.resolve({ data: null }),
    ])

  const patients: PatientOption[] = (
    (pts as { id: string; name: string; owner_id: string | null }[] | null) ?? []
  ).map((p) => ({ id: p.id, label: p.name, ownerId: p.owner_id }))
  const owners: SelectOption[] = ((owns as { id: string; full_name: string }[] | null) ?? []).map((o) => ({
    id: o.id,
    label: o.full_name,
  }))
  const vets: SelectOption[] = (
    (profs as { id: string; full_name: string | null }[] | null) ?? []
  ).map((v) => ({ id: v.id, label: v.full_name ?? "—" }))

  return (
    <div className="px-4 py-4 md:py-6 lg:px-6">
      {apptsError && (
        <div className="mb-3">
          <DataError>
            No se pudieron cargar las citas; el calendario puede verse vacío. Recargá la página.
          </DataError>
        </div>
      )}
      <AppointmentCalendar
        initialAppointments={(appts as unknown as AppointmentRow[] | null) ?? []}
        initialRange={{ start: rangeStart.toISOString(), end: rangeEnd.toISOString() }}
        patients={patients}
        owners={owners}
        vets={vets}
      />
    </div>
  )
}

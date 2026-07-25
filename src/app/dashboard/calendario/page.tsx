import { endOfWeek, startOfWeek } from "date-fns"

import { createClient } from "@/lib/supabase/server"
import { AppointmentCalendar } from "@/components/calendar/appointment-calendar"
import { DataError } from "@/components/data-error"
import { APPOINTMENT_SELECT, type AppointmentRow, type SelectOption } from "@/lib/appointments"

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

  const [{ data: appts, error: apptsError }, { data: pts }, { data: owns }, { data: profs }, { data: integ }] =
    await Promise.all([
      supabase
        .from("appointments")
        .select(APPOINTMENT_SELECT)
        .lte("starts_at", rangeEnd.toISOString())
        .gte("ends_at", rangeStart.toISOString())
        .order("starts_at", { ascending: true }),
      supabase.from("patients").select("id, name").order("name"),
      supabase.from("owners").select("id, full_name").order("full_name"),
      clinicId
        ? supabase.from("profiles").select("id, full_name").eq("clinic_id", clinicId)
        : Promise.resolve({ data: null }),
      // Solo columnas no-secretas (refresh_token/sync_token están revocadas al cliente).
      user
        ? supabase
            .from("calendar_integrations")
            .select("id, connected_at")
            .eq("user_id", user.id)
            .eq("provider", "google")
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  const googleConnected = Boolean(integ)

  const patients: SelectOption[] = ((pts as { id: string; name: string }[] | null) ?? []).map((p) => ({
    id: p.id,
    label: p.name,
  }))
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
        googleConnected={googleConnected}
      />
    </div>
  )
}

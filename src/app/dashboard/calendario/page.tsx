import { endOfWeek, startOfWeek } from "date-fns"

import { createClient } from "@/lib/supabase/server"
import { AppointmentCalendarLazy as AppointmentCalendar } from "@/components/calendar/appointment-calendar-lazy"
import { DataError } from "@/components/data-error"
import { DiaDeHoy, type CitaDeHoy } from "@/components/calendar/dia-de-hoy"
import { huecosDelDia } from "@/lib/agenda/huecos"
import { bogotaTodayISO } from "@/lib/date-utils"
import { localWeekday } from "@/lib/athos-agent/agenda"
import { APPOINTMENT_SELECT, type AppointmentRow, type PatientOption, type SelectOption } from "@/lib/appointments"

export const metadata = { title: "Agenda · Tuvetia" }


/** Los estados que ocupan un espacio de verdad. Una cancelada o un no-show lo liberan. */
const ESTADOS_VIVOS = new Set(["scheduled", "confirmed", "in_progress"])

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

  // El día de hoy como lista, encima de la grilla. Se arma con las citas QUE YA SE TRAJERON —la
  // semana incluye hoy— así que no cuesta ninguna consulta extra; sólo los horarios de atención,
  // que son cinco filas.
  const hoy = bogotaTodayISO()
  const { data: franjasHoy } = clinicId
    ? await supabase
        .from("clinic_hours")
        .select("opens_at, closes_at")
        .eq("clinic_id", clinicId)
        .eq("weekday", localWeekday(hoy))
    : { data: null }

  const citasDeHoy: CitaDeHoy[] = ((appts as unknown as AppointmentRow[] | null) ?? [])
    .filter((a) => a.starts_at.slice(0, 10) === hoy && ESTADOS_VIVOS.has(a.status))
    .map((a) => ({
      id: a.id,
      starts_at: a.starts_at,
      etiqueta: [a.patient?.name, a.title].filter(Boolean).join(" · ") || "Cita",
      estado: a.status,
    }))

  const huecos = huecosDelDia({
    date: hoy,
    franjas: ((franjasHoy as { opens_at: string; closes_at: string }[] | null) ?? []),
    // Los huecos se calculan contra TODAS las citas vivas del día, no sólo las que se listan:
    // una cita cancelada libera el espacio, una confirmada no.
    ocupados: ((appts as unknown as AppointmentRow[] | null) ?? [])
      .filter((a) => a.starts_at.slice(0, 10) === hoy && ESTADOS_VIVOS.has(a.status))
      .map((a) => ({ starts_at: a.starts_at, ends_at: a.ends_at })),
  })

  return (
    <div className="flex flex-col gap-6 p-[clamp(16px,3vw,32px)]">
      {/* SIN <h1> ACÁ, y es a propósito. Le puse uno `sr-only` en el PR #98 dando por hecho que la
          pantalla se quedaba sin encabezado, porque `page.tsx` no tenía ninguno. Medido después en
          producción: sí lo tiene — `AppointmentCalendar` renderiza <h1>Calendario</h1>. Con el mío
          quedaban DOS, que es el defecto que ese PR venía a arreglar.

          Es el mismo punto ciego que sí atrapé en `asistente` (su <h1> vive en `assistant.tsx`, no
          en su `page.tsx`) y que acá se me pasó: contar encabezados leyendo sólo el archivo de la
          página no alcanza cuando el título lo pone un componente hijo. */}
      {apptsError && (
        <DataError>
          No se pudieron cargar las citas; el calendario puede verse vacío. Recargá la página.
        </DataError>
      )}
      <DiaDeHoy citas={citasDeHoy} huecos={huecos} />
      <AppointmentCalendar
        initialAppointments={(appts as unknown as AppointmentRow[] | null) ?? []}
        initialRange={{ start: rangeStart.toISOString(), end: rangeEnd.toISOString() }}
        patients={patients}
        owners={owners}
        vets={vets}
        miId={user?.id ?? null}
      />
    </div>
  )
}

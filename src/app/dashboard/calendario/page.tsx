import { endOfWeek, startOfWeek } from "date-fns"

import { createClient } from "@/lib/supabase/server"
import { AppointmentCalendarLazy as AppointmentCalendar } from "@/components/calendar/appointment-calendar-lazy"
import { DataError } from "@/components/data-error"
import { APPOINTMENT_SELECT, type AppointmentRow, type PatientOption, type SelectOption } from "@/lib/appointments"

// REVERTIDO 2026-07-31 (incidente en producción): el pull automático al abrir esta página traía el
// calendario "primary" de Google —el personal del vet, no uno de la clínica— completo (30 días,
// paginado sin límite) y lo insertaba como citas visibles para toda la clínica. Con 1 usuario real
// generó 1.567 filas espurias ("Cumpleaños de mi mamá", "Trabajo", ...) antes de que el sync_token
// llegara a guardarse, así que cada carga de página lo repetía desde cero.
//
// RESUELTO 2026-08-02 (0048_calendar_admin_redesign): a partir de ahora hay UNA sola cuenta de
// Google/Outlook por clínica — la del administrador (clinics.owner_id), fijada una vez al crear la
// clínica — en vez de una por vet logueado. Ya no hay ambigüedad sobre "qué calendario de Google se
// sincroniza" (era el pendiente abierto en CALENDARIO.md). El pull sigue siendo manual (botón
// "Sincronizar") por la razón de fondo que causó el incidente original: no bloquear el render con
// una llamada a una API externa.

/**
 * Qué botón de calendario mostrar. Lo conectado MANDA sobre el proveedor del login: si la clínica ya
 * sincroniza con uno, el otro no se ofrece aunque el admin entre hoy con el otro proveedor — cambiar
 * de calendario es desconectar primero, no acumular dos.
 */
function pickCalendarProviders({
  googleConnected,
  microsoftConnected,
  canManage,
  loginProvider,
}: {
  googleConnected: boolean
  microsoftConnected: boolean
  canManage: boolean
  loginProvider: string | null
}): { showGoogle: boolean; showMicrosoft: boolean } {
  if (googleConnected) return { showGoogle: true, showMicrosoft: false }
  if (microsoftConnected) return { showGoogle: false, showMicrosoft: true }
  // Nada conectado: solo el admin puede conectar, y se le ofrece según cómo entró.
  if (!canManage) return { showGoogle: false, showMicrosoft: false }
  if (loginProvider === "azure") return { showGoogle: false, showMicrosoft: true }
  if (loginProvider === "google") return { showGoogle: true, showMicrosoft: false }
  return { showGoogle: true, showMicrosoft: true } // correo/magic link: que elija
}

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

  // Quién es el admin de la clínica (clinics.owner_id, ver 0048_calendar_admin_redesign): solo esa
  // cuenta puede conectar/reconectar Google u Outlook — el resto de la clínica ve el estado, nomás.
  const ownerId = clinicId
    ? ((await supabase.from("clinics").select("owner_id").eq("id", clinicId).maybeSingle()).data as
        | { owner_id: string | null }
        | null)?.owner_id ?? null
    : null
  const canManageCalendarConnection = Boolean(user && ownerId && user.id === ownerId)

  const [
    { data: appts, error: apptsError },
    { data: pts },
    { data: owns },
    { data: profs },
    { data: googleInteg },
    { data: microsoftInteg },
  ] = await Promise.all([
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
    // Solo columnas no-secretas (refresh_token/sync_token están revocadas al cliente). Por clínica,
    // no por user_id propio: la RLS de 0048 deja ver el estado de conexión del admin a cualquier
    // vet de la clínica (hay a lo sumo una fila por proveedor, la del admin).
    clinicId
      ? supabase
          .from("calendar_integrations")
          .select("id, connected_at")
          .eq("clinic_id", clinicId)
          .eq("provider", "google")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    clinicId
      ? supabase
          .from("calendar_integrations")
          .select("id, connected_at")
          .eq("clinic_id", clinicId)
          .eq("provider", "microsoft")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const googleConnected = Boolean(googleInteg)
  const microsoftConnected = Boolean(microsoftInteg)

  // Una clínica sincroniza con UN proveedor, y cuál es lo decide cómo entró el admin: con Google va
  // Google Calendar, con Microsoft va Outlook. Ofrecer los dos a la vez era el error: el vet elegía
  // uno, y el otro quedaba ahí invitando a conectar un segundo calendario que nadie va a mirar.
  //
  // Quien entró con correo/magic link no trae token de ningún proveedor, así que ahí sí se le
  // ofrecen los dos y el primero que conecte queda fijado (después ya no se ofrece el otro).
  const loginProvider =
    (user as { app_metadata?: { provider?: string } } | null)?.app_metadata?.provider ?? null
  const { showGoogle, showMicrosoft } = pickCalendarProviders({
    googleConnected,
    microsoftConnected,
    canManage: canManageCalendarConnection,
    loginProvider,
  })

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
        googleConnected={googleConnected}
        microsoftConnected={microsoftConnected}
        canManageCalendarConnection={canManageCalendarConnection}
        showGoogle={showGoogle}
        showMicrosoft={showMicrosoft}
      />
    </div>
  )
}

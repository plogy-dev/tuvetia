// Tipos y helpers del calendario interno (citas). Compartido entre el server component que hace la
// carga inicial y el calendario cliente (react-big-calendar). Puro: sin acceso a red.

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "canceled"
  | "no_show"

// Etiqueta (ES) + color del bloque en el calendario, por estado.
//
// Los colores son TOKENS, no literales. Se consumen sólo como `backgroundColor`
// en estilos inline (`appointment-calendar.tsx:321`, `calendar-chrome.tsx:125`),
// donde una `var()` resuelve igual que un hex — y de paso el calendario sigue al
// contexto: sobre la superficie grafito los seis se aclaran solos.
export const APPOINTMENT_STATUS: Record<AppointmentStatus, { label: string; color: string }> = {
  scheduled: { label: "Agendada", color: "var(--status-scheduled)" },
  confirmed: { label: "Confirmada", color: "var(--status-confirmed)" },
  in_progress: { label: "En curso", color: "var(--status-in-progress)" },
  completed: { label: "Completada", color: "var(--status-completed)" },
  canceled: { label: "Cancelada", color: "var(--status-canceled)" },
  no_show: { label: "No asistió", color: "var(--status-no-show)" },
}

export const APPOINTMENT_STATUS_ORDER: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "in_progress",
  "completed",
  "canceled",
  "no_show",
]

// Columnas que se piden a PostgREST (RLS aísla por clínica). El embed to-one patient:patients(name)
// llega como objeto plano en runtime (mismo gotcha documentado en DATABASE.md).
export const APPOINTMENT_SELECT =
  "id, title, reason, status, starts_at, ends_at, patient_id, owner_id, vet_id, notes, es_bloqueo, tipo, sin_hora, google_event_id, microsoft_event_id, calendar_owner_id, patient:patients(name)"

export type AppointmentRow = {
  id: string
  title: string
  reason: string | null
  status: AppointmentStatus
  starts_at: string
  ends_at: string
  patient_id: string | null
  owner_id: string | null
  vet_id: string | null
  notes: string | null
  /** Reserva de espacio sin paciente ni titular (0093). */
  es_bloqueo: boolean | null
  /** De qué es la cita. Null en las anteriores a la 0093. */
  tipo: string | null
  /** Cita de día completo. */
  sin_hora: boolean | null
  google_event_id: string | null
  microsoft_event_id: string | null
  /** En el calendario de qué usuario vive el evento — hace falta para borrarlo allá. */
  calendar_owner_id: string | null
  patient: { name: string } | null
}

// Evento en el formato que consume react-big-calendar.
export type CalendarEvent = {
  id: string
  title: string
  start: Date
  end: Date
  resource: AppointmentRow
}

export function toEvent(a: AppointmentRow): CalendarEvent {
  const who = a.patient?.name ? `${a.patient.name} — ` : ""
  const start = new Date(a.starts_at)
  const end = new Date(a.ends_at)
  return {
    id: a.id,
    title: `${who}${a.title}`,
    start,
    end: clampToStartDay(start, end),
    resource: a,
  }
}

// react-big-calendar trata cualquier evento cuyo fin cae en un día de calendario distinto al del
// inicio como si "cruzara" al día siguiente (aunque sea 1 minuto) — lo saca de la grilla horaria y
// lo muestra en una franja de "evento que abarca varios días" flotando sobre el encabezado, tapando
// el círculo de "hoy". Ninguna cita de esta app es real multi-día, así que para MOSTRAR (nunca se
// toca `starts_at`/`ends_at` en BD) recortamos cualquier fin que no caiga en el mismo día del inicio
// a las 23:59 de ese día — no solo el caso exacto de medianoche (00:00:00).
function clampToStartDay(start: Date, end: Date): Date {
  const sameDay =
    end.getFullYear() === start.getFullYear() &&
    end.getMonth() === start.getMonth() &&
    end.getDate() === start.getDate()
  if (sameDay) return end
  const endOfStartDay = new Date(start)
  endOfStartDay.setHours(23, 59, 0, 0)
  return endOfStartDay.getTime() > start.getTime() ? endOfStartDay : end
}

// Opción para los <Select> de titular / veterinario.
export type SelectOption = { id: string; label: string }

// Opción de paciente: trae su titular para el autocompletado/bloqueo del drawer (ver
// create-appointment-drawer.tsx) — elegir un paciente completa el titular, y si ya había un
// titular elegido que no es el suyo, se bloquea la selección.
export type PatientOption = SelectOption & { ownerId: string | null }

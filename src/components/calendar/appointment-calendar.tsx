"use client"

// Calendario interno (react-big-calendar) — v1a. Vistas mes/semana/día con bloques por estado,
// crear al hacer click en un slot, editar al hacer click en una cita, y drag/resize para mover.
// RLS de la BD aísla por clínica; las mutaciones de refs pasan por RPC (create/update_appointment),
// mover/redimensionar por UPDATE directo (solo cambia horas → seguro bajo RLS).

import { useCallback, useState, type ComponentType } from "react"
import {
  Calendar,
  dateFnsLocalizer,
  Views,
  type CalendarProps,
  type SlotInfo,
  type View,
} from "react-big-calendar"
import withDragAndDrop, {
  type EventInteractionArgs,
} from "react-big-calendar/lib/addons/dragAndDrop"
import { format, getDay, parse, startOfWeek } from "date-fns"
import { es } from "date-fns/locale"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import "react-big-calendar/lib/css/react-big-calendar.css"
import "react-big-calendar/lib/addons/dragAndDrop/styles.css"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  APPOINTMENT_SELECT,
  APPOINTMENT_STATUS,
  toEvent,
  type AppointmentRow,
  type CalendarEvent,
  type SelectOption,
} from "@/lib/appointments"
import {
  CreateAppointmentDrawer,
  type AppointmentFormInitial,
} from "./create-appointment-drawer"
import { HelpTip } from "@/components/help-tip"
import { GoogleCalendarConnect } from "./google-calendar-connect"
import { IcsFeedButton } from "./ics-feed-button"

const locales = { es }
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales })

// El HOC de drag&drop pierde el genérico del Calendar; se castea al tipo esperado y se re-tipa.
const DnDCalendar = withDragAndDrop<CalendarEvent, object>(
  Calendar as ComponentType<CalendarProps<CalendarEvent, object>>,
)

const MESSAGES = {
  date: "Fecha",
  time: "Hora",
  event: "Cita",
  allDay: "Todo el día",
  week: "Semana",
  work_week: "Semana laboral",
  day: "Día",
  month: "Mes",
  previous: "Anterior",
  next: "Siguiente",
  yesterday: "Ayer",
  tomorrow: "Mañana",
  today: "Hoy",
  agenda: "Agenda",
  noEventsInRange: "No hay citas en este rango.",
  showMore: (total: number) => `+${total} más`,
}

const DEFAULT_DURATION_MIN = 30

function normalizeRange(range: Date[] | { start: Date; end: Date }): { start: Date; end: Date } {
  if (Array.isArray(range)) return { start: range[0], end: range[range.length - 1] }
  return { start: range.start, end: range.end }
}

export function AppointmentCalendar({
  initialAppointments,
  initialRange,
  patients,
  owners,
  vets,
  googleConnected,
}: {
  initialAppointments: AppointmentRow[]
  initialRange: { start: string; end: string }
  patients: SelectOption[]
  owners: SelectOption[]
  vets: SelectOption[]
  googleConnected: boolean
}) {
  const [supabase] = useState(() => createClient())
  const [events, setEvents] = useState<CalendarEvent[]>(() => initialAppointments.map(toEvent))
  const [range, setRange] = useState<{ start: Date; end: Date }>(() => ({
    start: new Date(initialRange.start),
    end: new Date(initialRange.end),
  }))
  const [view, setView] = useState<View>(Views.WEEK)
  const [date, setDate] = useState<Date>(() => new Date(initialRange.start))

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerKey, setDrawerKey] = useState(0)
  const [initial, setInitial] = useState<AppointmentFormInitial | null>(null)

  const loadRange = useCallback(
    async (start: Date, end: Date) => {
      const { data, error } = await supabase
        .from("appointments")
        .select(APPOINTMENT_SELECT)
        .lte("starts_at", end.toISOString())
        .gte("ends_at", start.toISOString())
        .order("starts_at", { ascending: true })
      if (error) {
        toast.error(`No se pudieron cargar las citas: ${error.message}`)
        return
      }
      setEvents(((data ?? []) as unknown as AppointmentRow[]).map(toEvent))
    },
    [supabase],
  )

  const openDrawer = useCallback((init: AppointmentFormInitial) => {
    setInitial(init)
    setDrawerKey((k) => k + 1)
    setDrawerOpen(true)
  }, [])

  // Push/delete a Google: best-effort y solo si el vet conectó su calendario. El calendario interno
  // es la fuente de verdad; si Google falla, la cita local no se ve afectada.
  const pushToGoogle = useCallback(
    async (appointmentId: string) => {
      if (!googleConnected) return
      try {
        await fetch("/api/google/calendar/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appointmentId }),
        })
      } catch {
        /* best-effort */
      }
    },
    [googleConnected],
  )

  const deleteFromGoogle = useCallback(
    async (googleEventId: string | null) => {
      if (!googleConnected || !googleEventId) return
      try {
        await fetch("/api/google/calendar/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ google_event_id: googleEventId }),
        })
      } catch {
        /* best-effort */
      }
    },
    [googleConnected],
  )

  const handleRangeChange = useCallback(
    (r: Date[] | { start: Date; end: Date }) => {
      const nr = normalizeRange(r)
      setRange(nr)
      void loadRange(nr.start, nr.end)
    },
    [loadRange],
  )

  const handleSelectSlot = useCallback(
    (slot: SlotInfo) => {
      const end =
        slot.end.getTime() > slot.start.getTime()
          ? slot.end
          : new Date(slot.start.getTime() + DEFAULT_DURATION_MIN * 60000)
      openDrawer({ starts_at: slot.start.toISOString(), ends_at: end.toISOString() })
    },
    [openDrawer],
  )

  const handleSelectEvent = useCallback(
    (event: CalendarEvent) => {
      const a = event.resource
      openDrawer({
        id: a.id,
        title: a.title,
        reason: a.reason ?? undefined,
        status: a.status,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
        patient_id: a.patient_id,
        owner_id: a.owner_id,
        vet_id: a.vet_id,
        notes: a.notes ?? undefined,
        google_event_id: a.google_event_id,
      })
    },
    [openDrawer],
  )

  const move = useCallback(
    async ({ event, start, end }: EventInteractionArgs<CalendarEvent>) => {
      const s = new Date(start)
      const e = new Date(end)
      setEvents((prev) => prev.map((ev) => (ev.id === event.id ? { ...ev, start: s, end: e } : ev)))
      const { error } = await supabase
        .from("appointments")
        .update({ starts_at: s.toISOString(), ends_at: e.toISOString(), updated_at: new Date().toISOString() })
        .eq("id", event.id)
      if (error) {
        toast.error(`No se pudo mover la cita: ${error.message}`)
        void loadRange(range.start, range.end)
        return
      }
      void pushToGoogle(event.id)
    },
    [supabase, range, loadRange, pushToGoogle],
  )

  const handleSaved = useCallback(
    (appointmentId: string) => {
      void loadRange(range.start, range.end)
      if (appointmentId) void pushToGoogle(appointmentId)
    },
    [loadRange, range, pushToGoogle],
  )

  const handleDeleted = useCallback(
    (googleEventId: string | null) => {
      void loadRange(range.start, range.end)
      void deleteFromGoogle(googleEventId)
    },
    [loadRange, range, deleteFromGoogle],
  )

  function newAppointment() {
    const start = new Date()
    start.setMinutes(0, 0, 0)
    start.setHours(start.getHours() + 1)
    const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60000)
    openDrawer({ starts_at: start.toISOString(), ends_at: end.toISOString() })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-1.5 text-lg font-semibold">
          Calendario
          <HelpTip>
            Agendá y arrastrá citas. <b>Conectar Google Calendar</b> sincroniza en ambos sentidos;{" "}
            <b>Enlace ICS</b> muestra la agenda en Google sin conectar la cuenta (solo lectura).
          </HelpTip>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <IcsFeedButton />
          <GoogleCalendarConnect
            connected={googleConnected}
            onSynced={() => void loadRange(range.start, range.end)}
          />
          <Button onClick={newAppointment}>
            <PlusIcon /> Nueva cita
          </Button>
        </div>
      </div>

      <div className="h-[75vh] rounded-xl border bg-card p-2">
        <DnDCalendar
          localizer={localizer}
          culture="es"
          messages={MESSAGES}
          events={events}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
          onRangeChange={handleRangeChange}
          selectable
          onSelectSlot={handleSelectSlot}
          onSelectEvent={handleSelectEvent}
          onEventDrop={move}
          onEventResize={move}
          popup
          eventPropGetter={(event: CalendarEvent) => ({
            style: { backgroundColor: APPOINTMENT_STATUS[event.resource.status].color, border: "none" },
          })}
          style={{ height: "100%" }}
        />
      </div>

      {initial && (
        <CreateAppointmentDrawer
          key={drawerKey}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          initial={initial}
          patients={patients}
          owners={owners}
          vets={vets}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}

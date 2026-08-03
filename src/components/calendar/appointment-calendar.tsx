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
  type Formats,
  type SlotInfo,
  type View,
} from "react-big-calendar"
import withDragAndDrop, {
  type EventInteractionArgs,
} from "react-big-calendar/lib/addons/dragAndDrop"
import { format, getDay, parse, startOfWeek } from "date-fns"
import { es } from "date-fns/locale/es"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import "react-big-calendar/lib/css/react-big-calendar.css"
import "react-big-calendar/lib/addons/dragAndDrop/styles.css"
import "./calendar-theme.css"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  APPOINTMENT_SELECT,
  APPOINTMENT_STATUS,
  toEvent,
  type AppointmentRow,
  type CalendarEvent,
  type PatientOption,
  type SelectOption,
} from "@/lib/appointments"
import {
  CreateAppointmentDrawer,
  type AppointmentFormInitial,
} from "./create-appointment-drawer"
import { HelpTip } from "@/components/help-tip"
import { IcsFeedButton } from "./ics-feed-button"
import {
  AgendaEventContent,
  CalendarToolbar,
  DayColumnHeader,
  EventContent,
  formatGutterHour,
} from "./calendar-chrome"

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

// Eje de horas compacto ("6 AM" en vez de "06:00"), como Google Calendar.
const FORMATS: Formats = {
  timeGutterFormat: (date) => formatGutterHour(date),
}

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
}: {
  initialAppointments: AppointmentRow[]
  initialRange: { start: string; end: string }
  patients: PatientOption[]
  owners: SelectOption[]
  vets: SelectOption[]
}) {
  const [supabase] = useState(() => createClient())
  const [events, setEvents] = useState<CalendarEvent[]>(() => initialAppointments.map(toEvent))
  const [range, setRange] = useState<{ start: Date; end: Date }>(() => ({
    start: new Date(initialRange.start),
    end: new Date(initialRange.end),
  }))
  const [view, setView] = useState<View>(Views.WEEK)
  // Ancla en "hoy" si cae dentro del rango inicial (así Día/Agenda abren en hoy, no en el lunes de la
  // semana, al cambiar de vista) — si no, cae al inicio del rango como antes.
  const [date, setDate] = useState<Date>(() => {
    const now = new Date()
    const start = new Date(initialRange.start)
    const end = new Date(initialRange.end)
    return now >= start && now <= end ? now : start
  })

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

  // Push al calendario del VETERINARIO ASIGNADO. Se llama a los dos proveedores sin preguntar cuál
  // usa: el cliente no sabe —ni tiene por qué— si ese vet conectó Google, Outlook o nada. El
  // servidor resuelve su conexión y no hace nada si no tiene ninguna.
  //
  // Sigue siendo best-effort para la CITA: `appointments` es la fuente de verdad y si el proveedor
  // falla, la cita local queda igual. Lo que ya no es best-effort es el SILENCIO.
  //
  // Antes esto era un `Promise.allSettled` que descartaba todo, con el argumento de que el vet no
  // podía hacer nada con esos errores. Era falso: el motivo más común —no tener el calendario
  // conectado— se arregla con un clic, y mientras tanto la cita simplemente no aparecía y no había
  // forma de saber por qué. Pasó de verdad: se creó una cita dos minutos antes de conectar el
  // calendario. Se avisa sólo cuando NINGÚN proveedor creó el evento, para no molestar a quien tiene
  // Outlook con un "Google no está conectado" que le da igual.
  const pushAlCalendario = useCallback(async (appointmentId: string) => {
    const pedir = async (proveedor: string) => {
      try {
        const res = await fetch(`/api/${proveedor}/calendar/push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appointmentId }),
        })
        const j = (await res.json().catch(() => ({}))) as {
          google_event_id?: string | null
          microsoft_event_id?: string | null
          motivo?: string | null
          error?: string
        }
        if (!res.ok) return { creado: false, error: j.error ?? `HTTP ${res.status}`, motivo: null }
        return {
          creado: Boolean(j.google_event_id ?? j.microsoft_event_id),
          error: null,
          motivo: j.motivo ?? null,
        }
      } catch (e) {
        return { creado: false, error: (e as Error).message, motivo: null }
      }
    }

    const resultados = await Promise.all([pedir("google"), pedir("microsoft")])
    if (resultados.some((r) => r.creado)) return

    if (resultados.some((r) => r.motivo === "sin-administrador")) {
      toast.info("La cita se guardó. No se copió a ningún calendario porque la clínica no tiene administrador asignado.")
      return
    }
    if (resultados.some((r) => r.motivo === "sin-calendario")) {
      toast.info(
        "La cita se guardó, pero no se copió al calendario: el administrador de la clínica no conectó el suyo en Conexiones.",
      )
      return
    }
    const error = resultados.find((r) => r.error)?.error
    if (error) toast.error(`La cita se guardó, pero no se pudo copiar al calendario: ${error}`)
  }, [])

  // El borrado del evento externo ya NO vive acá: se hace en el drawer, antes de borrar la fila, con
  // `lib/calendar-remote.ts`. Mientras la cita existe, el servidor puede leer de ella en qué
  // calendario está y de quién es; hacerlo después obligaba a que el navegador mandara esos ids, y
  // nada los ataba a esta cita. Ver el encabezado de `api/google/calendar/delete/route.ts`.

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
        microsoft_event_id: a.microsoft_event_id,
        calendar_owner_id: a.calendar_owner_id,
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
      void pushAlCalendario(event.id)
    },
    [supabase, range, loadRange, pushAlCalendario],
  )

  const handleSaved = useCallback(
    (appointmentId: string) => {
      void loadRange(range.start, range.end)
      if (appointmentId) void pushAlCalendario(appointmentId)
    },
    [loadRange, range, pushAlCalendario],
  )

  const handleDeleted = useCallback(() => {
    void loadRange(range.start, range.end)
  }, [loadRange, range])

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
            Agendá y arrastrá citas. Cada cita aparece en el calendario del <b>veterinario
            asignado</b> e invita al titular — conectá el tuyo desde <b>Conexiones</b>. El{" "}
            <b>Enlace ICS</b> muestra la agenda en cualquier calendario sin conectar la cuenta (solo
            lectura).
          </HelpTip>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <IcsFeedButton />
          <Button onClick={newAppointment}>
            <PlusIcon /> Nueva cita
          </Button>
        </div>
      </div>

      <div className="tuvetia-calendar h-[75vh]">
        <DnDCalendar
          localizer={localizer}
          culture="es"
          messages={MESSAGES}
          formats={FORMATS}
          events={events}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          views={[Views.WEEK, Views.AGENDA]}
          onRangeChange={handleRangeChange}
          selectable
          onSelectSlot={handleSelectSlot}
          onSelectEvent={handleSelectEvent}
          onEventDrop={move}
          onEventResize={move}
          popup
          dayLayoutAlgorithm="overlap"
          components={{
            toolbar: CalendarToolbar,
            week: { header: DayColumnHeader, event: EventContent },
            agenda: { event: AgendaEventContent },
          }}
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

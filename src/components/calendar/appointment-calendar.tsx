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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { citasVisibles, deOtros, sinAsignar, type FiltroDeAgenda } from "@/lib/agenda/filtro"
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
  miId,
  veTodo,
  acotarA,
}: {
  initialAppointments: AppointmentRow[]
  initialRange: { start: string; end: string }
  patients: PatientOption[]
  owners: SelectOption[]
  vets: SelectOption[]
  /** Quién está mirando. Es lo que hace posible separar "mi agenda" de la de la clínica. */
  miId: string | null
  /**
   * Si esta persona tiene el permiso de ver la agenda de toda la clínica (0070).
   *
   * SIN EL PERMISO NO HAY INTERRUPTOR, y no es sólo por esconder el botón: sin permiso la consulta
   * ni siquiera trae las citas de los demás, así que un interruptor que no cambia nada sería peor
   * que no tenerlo — parecería que la clínica no tiene más citas que las tuyas.
   */
  veTodo: boolean
  /**
   * El `.or()` con el que se piden las citas, o `null` para pedirlas todas.
   *
   * LO CALCULA EL SERVIDOR y viaja como prop porque esta misma consulta se repite acá cada vez que
   * el vet cambia de semana. Aplicar el permiso sólo en la carga inicial no serviría de nada:
   * bastaría con avanzar una semana para volver a traerse la agenda de todos.
   */
  acotarA: string | null
}) {
  const [supabase] = useState(() => createClient())
  const [events, setEvents] = useState<CalendarEvent[]>(() => initialAppointments.map(toEvent))
  // ARRANCA EN "MI AGENDA". La pantalla cargaba las citas de TODA la clínica mezcladas: con cuatro
  // veterinarios, cada uno veía tres agendas ajenas encima de la suya y el propio día quedaba
  // ilegible justo en la pantalla que existe para leerlo.
  const [filtro, setFiltro] = useState<FiltroDeAgenda>("mia")
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
      const { data, error } = await (acotarA
        ? supabase.from("appointments").select(APPOINTMENT_SELECT).or(acotarA)
        : supabase.from("appointments").select(APPOINTMENT_SELECT)
      )
        .lte("starts_at", end.toISOString())
        .gte("ends_at", start.toISOString())
        .order("starts_at", { ascending: true })
      if (error) {
        toast.error(`No se pudieron cargar las citas: ${error.message}`)
        return
      }
      setEvents(((data ?? []) as unknown as AppointmentRow[]).map(toEvent))
    },
    [supabase, acotarA],
  )

  const openDrawer = useCallback((init: AppointmentFormInitial) => {
    setInitial(init)
    setDrawerKey((k) => k + 1)
    setDrawerOpen(true)
  }, [])

  // Push al calendario del VETERINARIO ASIGNADO —con el del administrador de respaldo— invitando al
  // titular, a todos los administradores y a quien la agendó (v5). Una sola llamada: en el
  // calendario de quién vive el evento y qué proveedor lo recibe lo resuelve el servidor.
  //
  // Sigue siendo best-effort para la CITA: `appointments` es la fuente de verdad y si el proveedor
  // falla, la cita local queda igual. Lo que ya no es best-effort es el SILENCIO.
  //
  // Antes esto descartaba todos los resultados, con el argumento de que el vet no podía hacer nada
  // con esos errores. Era falso: el motivo más común —que nadie conectó un calendario— se arregla
  // con un clic, y mientras tanto la cita simplemente no aparecía en ningún lado y no había forma
  // de saber por qué.
  const pushAlCalendario = useCallback(async (appointmentId: string) => {
    try {
      const res = await fetch("/api/calendario/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appointmentId }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        event_id?: string | null
        motivo?: string | null
        error?: string
      }
      if (!res.ok) {
        toast.error(`La cita se guardó, pero no se pudo copiar al calendario: ${j.error ?? res.status}`)
        return
      }
      if (j.event_id) return // llegó al calendario: sin ruido
      if (j.motivo === "sin-administrador") {
        toast.info("La cita se guardó. No se copió a ningún calendario porque no tiene veterinario asignado y la clínica no tiene administrador.")
      } else if (j.motivo === "sin-calendario") {
        toast.info(
          "La cita se guardó, pero no se copió a ningún calendario: ni el veterinario asignado ni el administrador conectaron el suyo en Integraciones.",
        )
      }
    } catch (e) {
      toast.error(`La cita se guardó, pero no se pudo copiar al calendario: ${(e as Error).message}`)
    }
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

  // Se filtra al PINTAR y no al cargar: las citas de los demás siguen en memoria, así que cambiar de
  // vista es instantáneo y no dispara otra consulta. Y el solapamiento se sigue detectando contra la
  // agenda completa — esconder una cita no puede volver libre un horario que está ocupado.
  const visibles = citasVisibles(
    events.map((e) => ({ ...e, vet_id: e.resource.vet_id })),
    filtro,
    miId,
  )
  // CUÁNTAS SE ESTÁN ESCONDIENDO — y sólo tiene sentido si de verdad hay algo escondido. Sin el
  // permiso, las citas de los demás nunca llegaron: contar cero y decirlo sería mentir por omisión
  // al revés, sugiriendo que la clínica no tiene más citas que las tuyas.
  const ocultas = veTodo && filtro === "mia" ? deOtros(events.map((e) => e.resource), miId) : 0
  const huerfanas = sinAsignar(events.map((e) => e.resource))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-1.5 text-lg font-semibold">
          Calendario
          <HelpTip>
            Agendá y arrastrá citas. Cada cita se crea en el calendario del <b>veterinario
            asignado</b> e invita al titular, a los <b>administradores</b> y a quien la agendó —
            conectá el tuyo desde <b>Integraciones</b>. El <b>Enlace ICS</b> muestra la agenda en
            cualquier calendario sin conectar la cuenta (solo lectura).
          </HelpTip>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* EL INTERRUPTOR. Dice cuántas citas está escondiendo: filtrar sin decirlo es ocultar, y
              en una agenda clínica eso se paga con alguien que no fue a una cita. */}
          {veTodo && miId && (
            <ToggleGroup
              // Base UI maneja el valor como ARREGLO aunque la selección sea única. `?? filtro`
              // ignora el intento de des-seleccionar: la agenda siempre muestra algo — quedarse sin
              // ninguna de las dos vistas dejaría la pantalla en blanco sin que nadie lo pidiera.
              value={[filtro]}
              onValueChange={(v) => setFiltro(((v as string[])[0] as FiltroDeAgenda) ?? filtro)}
              variant="outline"
              size="sm"
              aria-label="De quién son las citas que se ven"
            >
              <ToggleGroupItem value="mia">Mi agenda</ToggleGroupItem>
              <ToggleGroupItem value="clinica">
                Toda la clínica
                {ocultas > 0 && (
                  <span className="ml-1.5 font-mono text-[11px] tabular-nums text-fg-faint">
                    +{ocultas}
                  </span>
                )}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          {/* LAS QUE NO SON DE NADIE se dicen en voz alta. Aparecen en las dos vistas —esconderlas
              en "mi agenda" las dejaría fuera de la pantalla por defecto de TODAS las personas de la
              clínica, y una cita que nadie mira es una cita a la que no va nadie— pero mostrarlas
              sin más las vuelve indistinguibles de las propias. Este contador es lo que pide que
              alguien las reclame. */}
          {huerfanas > 0 && (
            <span
              className="rounded-full border border-warn/40 bg-warn-soft px-2 py-0.5 text-[11.5px] font-medium text-fg"
              title="Citas sin veterinario asignado. Se ven en las dos vistas hasta que alguien las tome."
            >
              {huerfanas} sin asignar
            </span>
          )}
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
          events={visibles}
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

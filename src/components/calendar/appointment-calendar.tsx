"use client"

// Calendario interno (react-big-calendar) — v1a. Vistas mes/semana/día con bloques por estado,
// crear al hacer click en un slot, editar al hacer click en una cita, y drag/resize para mover.
// RLS de la BD aísla por clínica; las mutaciones de refs pasan por RPC (create/update_appointment),
// mover/redimensionar por UPDATE directo (solo cambia horas → seguro bajo RLS).

import { useCallback, useMemo, useState, type ComponentType } from "react"
import {
  Calendar,
  dateFnsLocalizer,
  Views,
  type CalendarProps,
  type Formats,
  type SlotInfo,
  type ToolbarProps,
  type View,
} from "react-big-calendar"
import withDragAndDrop, {
  type EventInteractionArgs,
} from "react-big-calendar/lib/addons/dragAndDrop"
import { format, getDay, parse, startOfWeek } from "date-fns"
import { es } from "date-fns/locale/es"
import { PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"

import "react-big-calendar/lib/css/react-big-calendar.css"
import "react-big-calendar/lib/addons/dragAndDrop/styles.css"
import "./calendar-theme.css"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { coincideConLaBusqueda } from "@/lib/agenda/buscar"
import { comoFechas, rangoVisible, type FranjaHoraria } from "@/lib/agenda/rango-visible"
import { tipoDeCita } from "@/lib/agenda/tipos-de-cita"
import { PanelDeAgenda } from "./panel-de-agenda"
import { AvisoDeLaCita, type ResultadoDeAviso } from "./aviso-de-la-cita"
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

/** Por qué una cita no llegó a ningún calendario, dicho para el vet y no para el log. */
const MOTIVO_DEL_CALENDARIO: Record<string, string> = {
  "sin-administrador": "La cita no tiene veterinario asignado y la clínica no tiene administrador.",
  "sin-calendario":
    "Ni el veterinario asignado ni el administrador conectaron su calendario en Integraciones.",
}

/**
 * El id de la columna «Sin asignar» del Programador.
 *
 * NO es `null`: la librería agrupa por el id del recurso y un `null` no hace juego con ninguna
 * columna, así que esas citas se caerían de la vista. Se les da una columna real con un id que
 * ningún perfil puede tener — y son justamente las que hay que ver, para que alguien las tome.
 */
const SIN_ASIGNAR = "sin-asignar"

/** Una columna del Programador: un veterinario. `object` es lo que tipa la librería. */
type RecursoDeVet = { id: string; title: string }

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
  avisosActivos = false,
  franjas = [],
}: {
  initialAppointments: AppointmentRow[]
  initialRange: { start: string; end: string }
  patients: PatientOption[]
  owners: SelectOption[]
  vets: SelectOption[]
  /**
   * El horario de atención de la clínica, de toda la semana. Decide QUÉ HORAS DIBUJA LA GRILLA.
   *
   * Vacío no rompe nada: `rangoVisible` cae en una jornada por defecto. Es lo que ve una clínica
   * que todavía no cargó su horario en Configuración.
   */
  franjas?: FranjaHoraria[]
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
  /** Si la clínica tiene encendidos los avisos de cita. El panel lo DICE, no lo cambia. */
  avisosActivos?: boolean
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

  // Qué se escribió en el buscador de la agenda. Filtra al PINTAR, sobre lo que ya está en memoria:
  // buscar no puede costar una consulta por tecla, y el rango que se está mirando ya está cargado.
  const [busqueda, setBusqueda] = useState("")
  // Qué calendarios se ven. `null` = todos, que es distinto de "el conjunto vacío": arrancar con un
  // conjunto obligaría a mantenerlo sincronizado cada vez que entra alguien nuevo al equipo.
  const [vetsVisibles, setVetsVisibles] = useState<Set<string> | null>(null)
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
  // `resultados: null` es «se está avisando»: la ventana abre enseguida con el título y el
  // detalle aparece cuando los canales contestan.
  const [aviso, setAviso] = useState<{ titulo: string; resultados: ResultadoDeAviso[] | null } | null>(
    null,
  )

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
  const pushAlCalendario = useCallback(async (appointmentId: string): Promise<ResultadoDeAviso> => {
    const fallo = (motivo: string): ResultadoDeAviso => ({
      canal: "calendario",
      ok: false,
      destino: null,
      motivo,
    })
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
      if (!res.ok) return fallo(j.error ?? `Error ${res.status} del servidor.`)
      if (j.event_id) {
        return { canal: "calendario", ok: true, destino: "Titular y administradores", motivo: null }
      }
      return fallo(MOTIVO_DEL_CALENDARIO[j.motivo ?? ""] ?? "No se pudo copiar al calendario.")
    } catch (e) {
      return fallo((e as Error).message)
    }
  }, [])

  /** El WhatsApp al titular. Mismo trato: devuelve qué pasó, no lo grita por un toast. */
  const confirmarAlTitular = useCallback(async (appointmentId: string): Promise<ResultadoDeAviso> => {
    try {
      const res = await fetch("/api/citas/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appointmentId }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        destino?: string | null
        motivo?: string | null
        error?: string
      }
      if (!res.ok) {
        return { canal: "whatsapp", ok: false, destino: null, motivo: j.error ?? `Error ${res.status}.` }
      }
      return {
        canal: "whatsapp",
        ok: Boolean(j.ok),
        destino: j.destino ?? null,
        motivo: j.motivo ?? null,
      }
    } catch (e) {
      return { canal: "whatsapp", ok: false, destino: null, motivo: (e as Error).message }
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
        es_bloqueo: a.es_bloqueo ?? false,
        tipo: a.tipo,
        sin_hora: a.sin_hora ?? false,
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
      // Arrastrar sólo cambió la hora: se re-empuja el evento pero sin ventana — no es un
      // acto de agendar y frenar al vet con un diálogo por cada arrastre sería insufrible.
      void pushAlCalendario(event.id)
    },
    [supabase, range, loadRange, pushAlCalendario],
  )

  /**
   * Al guardar: refrescar la grilla, avisar por los dos canales y CONTAR qué pasó.
   *
   * Los dos salen EN PARALELO y ninguno espera al otro: son independientes —uno va a Google o a
   * Outlook, el otro al proveedor de WhatsApp— y encadenarlos le sumaría al vet la latencia de los
   * dos mirando una ventana que todavía no dice nada.
   *
   * La ventana se abre igual cuando los dos fallan. Es justamente cuando más hace falta: la cita
   * está guardada y el titular no se enteró, y eso hay que decirlo en la cara y no en un toast que
   * se va solo a los cinco segundos.
   */
  const handleSaved = useCallback(
    async (appointmentId: string, esEdicion: boolean, avisarAlTitular: boolean) => {
      void loadRange(range.start, range.end)
      if (!appointmentId) return

      const titulo = esEdicion ? "Cita actualizada" : "Cita creada"
      setAviso({ titulo, resultados: null })
      // EL CALENDARIO SE EMPUJA SIEMPRE y el WhatsApp no, y la diferencia no es un descuido:
      // actualizar un evento que ya existe no le llega a nadie como mensaje nuevo, mientras
      // que cada WhatsApp es una notificación en el teléfono de un cliente. Quién merece el
      // aviso lo decidió el drawer, que es el único que sabe qué cambió.
      const [calendario, whatsapp] = await Promise.all([
        pushAlCalendario(appointmentId),
        avisarAlTitular ? confirmarAlTitular(appointmentId) : Promise.resolve(null),
      ])
      // WhatsApp primero: es la vía por la que el titular se entera de verdad, así que es el
      // renglón que el vet tiene que leer antes de cerrar la ventana.
      setAviso({ titulo, resultados: [whatsapp, calendario].filter((r) => r !== null) })
    },
    [loadRange, range, pushAlCalendario, confirmarAlTitular],
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
    events.map((e) => ({
      ...e,
      vet_id: e.resource.vet_id,
      // `resourceId` es lo que la vista Programador usa para poner cada cita en su columna. Va
      // SIEMPRE, no sólo en esa vista: calcularlo condicionalmente obligaría a rehacer el arreglo
      // al cambiar de vista, y no cuesta nada.
      resourceId: e.resource.vet_id ?? SIN_ASIGNAR,
    })),
    filtro,
    miId,
  )
    // LOS CALENDARIOS APAGADOS EN EL PANEL. `null` = todos. Las citas sin veterinario se ven
    // siempre: son de todos y de nadie, y esconderlas detrás de una casilla que no existe las
    // dejaría fuera de la pantalla sin que nadie pueda traerlas de vuelta.
    .filter((e) => vetsVisibles === null || !e.resource.vet_id || vetsVisibles.has(e.resource.vet_id))
    // EL BUSCADOR. Filtra sobre lo que ya está en memoria —el rango que se está mirando— así que no
    // cuesta una consulta por tecla. Mira el paciente, el título y el motivo, que es por lo que se
    // busca una cita: «¿a qué hora era lo de Luna?».
    .filter((e) => coincideConLaBusqueda(e.resource, busqueda))
  // CUÁNTAS SE ESTÁN ESCONDIENDO — y sólo tiene sentido si de verdad hay algo escondido. Sin el
  // permiso, las citas de los demás nunca llegaron: contar cero y decirlo sería mentir por omisión
  // al revés, sugiriendo que la clínica no tiene más citas que las tuyas.
  const ocultas = veTodo && filtro === "mia" ? deOtros(events.map((e) => e.resource), miId) : 0
  const huerfanas = sinAsignar(events.map((e) => e.resource))

  const esProgramador = view === ("programador" as View)

  // ── QUÉ HORAS SE DIBUJAN ──────────────────────────────────────────────────────────────────────
  //
  // Sin esto la librería dibuja las VEINTICUATRO, y con los 72 px por hora que necesita una cita de
  // media hora para ser legible eso son 1.728 px: al abrir la agenda lo primero que se ve son las
  // filas de la madrugada y las 8 de la mañana quedan fuera de pantalla.
  //
  // Se calcula sobre `events` y no sobre los filtrados: una cita que el filtro «mi agenda» esconde
  // no tiene por qué achicar la grilla, pero tampoco puede achicarla y que al soltar el filtro
  // aparezca fuera de rango. Con todas, el alto de la grilla no cambia al filtrar — y una grilla
  // que cambia de tamaño cada vez que tocás un interruptor se siente rota.
  const rango = useMemo(
    () => rangoVisible(franjas, events.map((e) => ({ inicio: e.start, fin: e.end }))),
    [franjas, events],
  )
  const { min: horaMin, max: horaMax } = useMemo(() => comoFechas(rango, date), [rango, date])

  // Dónde queda parada la grilla al abrir. Es el inicio del rango y no `new Date()`: a las 8 de la
  // noche, arrancar en «ahora» deja la jornada entera arriba y fuera de vista.
  const scrollA = useMemo(() => {
    const d = new Date(date)
    d.setHours(rango.desdeHora, 0, 0, 0)
    return d
  }, [date, rango.desdeHora])

  // Los componentes que react-big-calendar usa por dentro.
  //
  // MEMOIZADO, y no es micro-optimización: `components` es lo que la librería usa para construir
  // sus hijos, así que un objeto nuevo en cada render los desmonta y los vuelve a montar. Con el
  // toolbar eso se nota — el campo de búsqueda perdía el foco mientras se escribía.
  //
  // El toolbar va envuelto para pisarle el `view`: la librería le manda el suyo (`Views.DAY` en
  // Programador) y hay que resaltar contra el de la app.
  const componentes = useMemo(
    () => ({
      toolbar: (props: ToolbarProps<CalendarEvent, object>) => (
        <CalendarToolbar {...props} view={view} />
      ),
      week: { header: DayColumnHeader, event: EventContent },
      agenda: { event: AgendaEventContent },
    }),
    [view],
  )

  // LAS COLUMNAS DEL PROGRAMADOR, acotadas a los calendarios que estén encendidos en el panel.
  const vetsDelDia: RecursoDeVet[] = [
    { id: SIN_ASIGNAR, title: "Sin asignar" },
    ...vets
      .filter((v) => vetsVisibles === null || vetsVisibles.has(v.id))
      .map((v) => ({ id: v.id, title: v.label })),
  ]

  return (
    // ── DOS COLUMNAS ────────────────────────────────────────────────────────────────────────
    // El panel a la izquierda y la agenda a la derecha, como cualquier agenda profesional. En
    // pantalla angosta se apila: el mini calendario arriba sigue sirviendo para saltar de fecha y
    // la grilla debajo se recorre igual.
    //
    // `lg:flex-1 lg:min-h-0` — hereda el alto acotado que baja `calendario/page.tsx`, para que la
    // grilla llene lo que queda de pantalla con scroll interno. SIN `lg:items-start`: las columnas
    // se estiran al alto de la fila (es lo que le da alto al `flex-1` del calendario); el panel no
    // cambia a la vista porque su contenido ya vive arriba y su raíz no pinta fondo.
    <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-5">
      <PanelDeAgenda
        fecha={date}
        onElegirFecha={(d) => {
          setDate(d)
          // Saltar desde el mini calendario abre el DÍA: si se eligió un día puntual es porque
          // interesa ese día. Desde Mes no se toca, que ahí el gesto natural es seguir viendo el
          // mes con el día resaltado.
          if (view === Views.WEEK) setView(Views.DAY)
        }}
        vets={vets}
        vetsVisibles={vetsVisibles}
        onAlternarVet={(id) =>
          setVetsVisibles((prev) => {
            // `null` = todos. Al destildar el primero hay que materializar el conjunto con TODOS
            // menos ése; si no, el primer clic dejaría la pantalla con un solo calendario.
            const base = prev ?? new Set(vets.map((v) => v.id))
            const siguiente = new Set(base)
            if (siguiente.has(id)) siguiente.delete(id)
            else siguiente.add(id)
            // Volver a tenerlos todos vuelve a `null`: así un vet nuevo entra visible solo.
            return siguiente.size === vets.length ? null : siguiente
          })
        }
        avisosActivos={avisosActivos}
      />

      {/* `lg:min-h-0`: sin él, esta columna no puede encogerse por debajo de su contenido y el
          alto heredado no llega al calendario de abajo. */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 lg:min-h-0">
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
          {/* ── BUSCAR EN LO QUE SE ESTÁ VIENDO ────────────────────────────────────────────
              Filtra sobre las citas YA cargadas —las del rango en pantalla— así que no cuesta un
              viaje por tecla. La contrapartida se dice en el marcador: busca en lo que se ve, no en
              toda la historia. Es lo correcto para un buscador dentro de la agenda — el resultado
              tiene que ser algo que se pueda ver ahí mismo, en su día y su hora. Para buscar en
              todo está el buscador del encabezado del panel. */}
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-faint"
              aria-hidden
            />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar en la vista…"
              aria-label="Buscar citas en el rango que se está viendo"
              className="h-8 w-44 pl-8 text-[13px]"
            />
          </div>
          <Button onClick={newAppointment}>
            <PlusIcon /> Nueva cita
          </Button>
        </div>
      </div>

      {/* `overflow-x-auto` + ancho mínimo interno: sin esto, en una ventana angosta las siete
          columnas de la semana se COMPRIMÍAN hasta truncar la hora y el título de cada cita —
          «que no corte calendarios» (David, 25-ago). Con esto el calendario scrollea DENTRO de su
          marco, que es la regla de todo contenido ancho en este repo (tablas incluidas). El
          mínimo son ~90 px por día + la regla horaria: debajo de eso una cita no alcanza a decir
          ni la hora. `svh` y no `vh`: en móvil, `vh` incluye la barra del navegador y el pie del
          calendario quedaba debajo de ella.

          EL ALTO: en `lg:` ya no son 75svh fijos —que en un portátil de 768 px sumados a «Hoy»
          garantizaban scroll de página— sino `flex-1`: lo que quede de la columna acotada que baja
          la página.

          EL PISO BAJA DE 420 A 220 PX, Y NO SE PIERDE NADA. `flex-1` le da a la grilla TODO el
          sobrante de la columna, así que en un monitor normal sigue midiendo 420 o mucho más: el
          piso sólo entra en juego cuando el espacio escasea, que es justo cuando 420 dejaba de
          caber y empujaba la página entera.

          Los 420 salían de una decisión razonable que resultó cara —«antes de dejar la grilla
          inusable, se prefiere devolverle unos px de scroll a la página»— y el cliente lo reportó
          DOS veces el 26-ago; la segunda con la corrección de escala: «literalmente me toca
          escrollear hasta abajo para verla completa». No eran unos px.

          A 220 px la grilla no queda inusable: `rbc-time-content` scrollea por dentro, que es lo
          que esta pantalla viene diciendo desde arriba — el scroll vive en la rejilla de horas y
          no en la página. */}
      <div className="tuvetia-calendar h-[75svh] overflow-x-auto lg:h-auto lg:min-h-[220px] lg:flex-1">
        <div className="h-full min-w-[700px]">
        <DnDCalendar
          localizer={localizer}
          culture="es"
          messages={MESSAGES}
          formats={FORMATS}
          events={visibles}
          onView={setView}
          date={date}
          onNavigate={setDate}
          // «Programador» NO es una vista de la librería: es el DÍA con una columna por
          // veterinario (`resources`). Por eso lo que se le pasa acá es `day` — el rótulo del botón
          // es lo único que cambia, y `esProgramador` decide si se le dan recursos.
          view={esProgramador ? Views.DAY : view}
          views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
          {...(esProgramador
            ? {
                resources: vetsDelDia,
                resourceIdAccessor: (r: object) => (r as RecursoDeVet).id,
                resourceTitleAccessor: (r: object) => (r as RecursoDeVet).title,
              }
            : {})}
          min={horaMin}
          max={horaMax}
          scrollToTime={scrollA}
          onRangeChange={handleRangeChange}
          selectable
          onSelectSlot={handleSelectSlot}
          onSelectEvent={handleSelectEvent}
          onEventDrop={move}
          onEventResize={move}
          popup
          dayLayoutAlgorithm="overlap"
          /* AL TOOLBAR LE VA EL `view` DE LA APP, NO EL DE LA LIBRERÍA.
              «Programador» no es una vista de react-big-calendar: se dibuja con la de día más
              recursos, así que abajo se le pasa `Views.DAY`. Y esa es la que la librería le
              reenvía al toolbar, que resalta comparando contra ella — o sea que estando en
              Programador aparecía encendido «Día», y tocar ese botón ya encendido hacía
              desaparecer las columnas por veterinario sin ninguna señal de qué pasó.
              `vistaDeLaApp` es la que el usuario eligió; es contra ésa que hay que resaltar. */
          components={componentes}
          /* ── DE QUÉ COLOR VA CADA BLOQUE ─────────────────────────────────────────────────
              El TIPO manda cuando lo hay: es lo que se busca con la vista en una semana llena
              —dónde están las cirugías, cuántas vacunaciones— y el estado ya se lee en la lista.

              Sin tipo se cae al ESTADO, que es como se pintaba antes de la 0093. Las citas
              anteriores no tienen tipo y darles uno por defecto sería inventarles un dato.

              UN BLOQUEO SE VE DISTINTO A PROPÓSITO: rayado y apagado. Ocupa la agenda igual que una
              cita, pero no es una — y si se vieran iguales, el vet contaría un almuerzo como
              paciente atendido. */
          eventPropGetter={(event: CalendarEvent) => {
            const a = event.resource
            if (a.es_bloqueo) {
              return {
                style: {
                  backgroundColor: "var(--color-muted)",
                  backgroundImage:
                    "repeating-linear-gradient(45deg, transparent, transparent 5px, color-mix(in srgb, var(--color-fg-faint) 22%, transparent) 5px, color-mix(in srgb, var(--color-fg-faint) 22%, transparent) 10px)",
                  border: "1px solid var(--color-line-strong)",
                  color: "var(--color-fg-muted)",
                },
              }
            }
            const porTipo = tipoDeCita(a.tipo)?.color
            return {
              style: {
                backgroundColor: porTipo ?? APPOINTMENT_STATUS[a.status].color,
                border: "none",
              },
            }
          }}
          style={{ height: "100%" }}
        />
        </div>
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

      {aviso && (
        <AvisoDeLaCita
          abierto
          onCerrar={() => setAviso(null)}
          titulo={aviso.titulo}
          resultados={aviso.resultados}
        />
      )}
      </div>
    </div>
  )
}

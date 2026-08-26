"use client"

// Piezas de react-big-calendar reemplazadas para que el calendario se vea como Google Calendar:
// toolbar (shadcn Button + Select), encabezado de día (semana/día) con círculo en "hoy", y contenido
// de evento (título + rango horario en dos líneas). Solo tocan lo visual — la lógica de datos,
// drag&drop y RPCs sigue toda en appointment-calendar.tsx sin cambios.

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { format, isSameDay } from "date-fns"
import { es } from "date-fns/locale/es"
import type { EventProps, HeaderProps, ToolbarProps, View } from "react-big-calendar"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { APPOINTMENT_STATUS, type CalendarEvent } from "@/lib/appointments"

const VIEW_OPTIONS: { value: string; label: string }[] = [
  { value: "week", label: "Semana" },
  { value: "agenda", label: "Agenda" },
]

export function CalendarToolbar({
  label,
  view,
  onNavigate,
  onView,
}: ToolbarProps<CalendarEvent, object>) {
  return (
    // `mb-3` y no `mb-2`: la barra estaba pegada al marco del calendario y se leía como parte de la
    // grilla en vez de como sus controles.
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onNavigate("TODAY")}>
          Hoy
        </Button>
        {/* Las flechas agrupadas en un control con borde, no sueltas: son un par y se usan como un
            par. Antes flotaban entre "Hoy" y la fecha sin pertenecer a ninguno de los dos. */}
        <div className="flex items-center rounded-lg border border-line">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Semana anterior"
            className="rounded-r-none"
            onClick={() => onNavigate("PREV")}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="h-5 w-px bg-line" aria-hidden />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Semana siguiente"
            className="rounded-l-none"
            onClick={() => onNavigate("NEXT")}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        {/* En display y con tracking, como los títulos del resto de la app: es la etiqueta del rango
            que se está mirando, no un texto más de la barra. */}
        <span className="font-display text-[17px] font-medium tracking-[-0.01em] text-fg capitalize">
          {label}
        </span>
      </div>
      <Select value={view} onValueChange={(v) => onView(v as View)}>
        <SelectTrigger size="sm" className="w-28">
          <SelectValue>{VIEW_OPTIONS.find((o) => o.value === view)?.label ?? view}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {VIEW_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// Encabezado de columna en semana/día: abreviatura del día arriba, número de fecha abajo — con
// círculo relleno cuando es hoy (igual que Google Calendar).
export function DayColumnHeader({ date }: HeaderProps) {
  const today = isSameDay(date, new Date())
  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {format(date, "EEE", { locale: es })}
      </span>
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-sm font-semibold",
          today ? "bg-primary text-primary-foreground" : "text-foreground",
        )}
      >
        {format(date, "d")}
      </span>
    </div>
  )
}

function formatCompactTime(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  const period = h < 12 ? "am" : "pm"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`
}

/**
 * Contenido del bloque de una cita, EN UNA O DOS LÍNEAS SEGÚN LO QUE MIDA.
 *
 * ── EL DEFECTO QUE ESTO ARREGLA ────────────────────────────────────────────────────────────────
 *
 * Antes eran siempre dos líneas —título arriba, rango horario abajo—, y una cita de 30 minutos no
 * tiene alto para dos: lo que se veía era el título cortado por la mitad, con la hora asomando
 * debajo. O sea que la información que la agenda existe para dar —de quién es la cita— era
 * justamente la que no se leía.
 *
 * La altura de fila subió a 72px por hora (ver `calendar-theme.css`), pero eso solo no alcanza: una
 * cita de 15 o 20 minutos sigue sin entrar en dos líneas y siempre las va a haber. Así que el
 * bloque decide por su duración, que es un dato que ya tiene y no cuesta nada.
 *
 * El corte está en 40 minutos: por debajo, el título y la hora comparten renglón —la hora primero,
 * en pequeño, que es como la lee cualquiera que está barriendo la columna con la vista— y por
 * encima van en dos líneas, con aire.
 */
export function EventContent({ event, title }: EventProps<CalendarEvent>) {
  const minutos = (event.end.getTime() - event.start.getTime()) / 60000
  const rango = `${formatCompactTime(event.start)} – ${formatCompactTime(event.end)}`

  if (minutos < 40) {
    return (
      <div className="flex h-full items-center gap-1.5 overflow-hidden px-1.5 text-left leading-none text-white">
        <span className="shrink-0 text-[10.5px] font-medium tabular-nums opacity-90">
          {formatCompactTime(event.start)}
        </span>
        <span className="truncate font-medium">{title}</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden px-2 py-1 text-left leading-tight text-white">
      <span className="truncate font-medium">{title}</span>
      <span className="truncate text-[11px] tabular-nums opacity-90">{rango}</span>
    </div>
  )
}

/**
 * Contenido de evento en la vista Agenda: punto de estado, título y el estado dicho con palabras.
 *
 * El punto de color solo no informa a nadie: hay seis estados y nadie se aprende la paleta. En una
 * LISTA hay ancho de sobra para escribirlo, que es justo lo que la vista de semana no tiene — ahí
 * el color es lo único que entra, y acá sobra espacio para decirlo.
 *
 * Nada de fondo sólido: `eventPropGetter` pinta los bloques de la semana y en la tabla queda
 * anulado por CSS, igual que hace Google Calendar en su vista de lista.
 */
export function AgendaEventContent({ event, title }: EventProps<CalendarEvent>) {
  const estado = APPOINTMENT_STATUS[event.resource.status]
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="inline-flex min-w-0 items-center gap-2">
        <span
          className="inline-block size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: estado.color }}
        />
        <span className="truncate font-medium text-fg">{title}</span>
      </span>
      <span
        className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: `color-mix(in srgb, ${estado.color} 14%, transparent)`,
          color: estado.color,
        }}
      >
        {estado.label}
      </span>
    </span>
  )
}

// Formato compacto del eje de horas ("6 AM" en vez de "06:00").
export function formatGutterHour(date: Date): string {
  const h = date.getHours()
  const period = h < 12 ? "AM" : "PM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${period}`
}

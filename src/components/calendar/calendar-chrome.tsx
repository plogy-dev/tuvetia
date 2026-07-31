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
import type { CalendarEvent } from "@/lib/appointments"

const VIEW_OPTIONS: { value: string; label: string }[] = [
  { value: "month", label: "Mes" },
  { value: "week", label: "Semana" },
  { value: "day", label: "Día" },
  { value: "agenda", label: "Agenda" },
]

export function CalendarToolbar({
  label,
  view,
  onNavigate,
  onView,
}: ToolbarProps<CalendarEvent, object>) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-0.5">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onNavigate("TODAY")}>
          Hoy
        </Button>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Anterior"
            onClick={() => onNavigate("PREV")}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Siguiente"
            onClick={() => onNavigate("NEXT")}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <span className="text-base font-medium capitalize">{label}</span>
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

// Contenido del bloque de evento en semana/día: título + hora, dos líneas como en Google Calendar.
export function EventContent({ event, title }: EventProps<CalendarEvent>) {
  return (
    <div className="flex h-full flex-col overflow-hidden px-1.5 py-0.5 text-left leading-tight text-white">
      <span className="truncate font-medium">{title}</span>
      <span className="truncate text-[11px] opacity-90">
        {formatCompactTime(event.start)} – {formatCompactTime(event.end)}
      </span>
    </div>
  )
}

// Formato compacto del eje de horas ("6 AM" en vez de "06:00").
export function formatGutterHour(date: Date): string {
  const h = date.getHours()
  const period = h < 12 ? "AM" : "PM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${period}`
}

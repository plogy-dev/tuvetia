"use client"

// react-big-calendar (+drag&drop +2 CSS) es pesado y bloqueaba la interactividad de la ruta:
// se difiere con next/dynamic (ssr:false) y un skeleton mientras baja el chunk.
import dynamic from "next/dynamic"

export const AppointmentCalendarLazy = dynamic(
  () => import("./appointment-calendar").then((m) => m.AppointmentCalendar),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[70vh] animate-pulse items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        Cargando calendario…
      </div>
    ),
  },
)

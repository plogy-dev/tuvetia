import Link from "next/link"
import { CalendarClock, ChevronRight } from "lucide-react"

import { APPOINTMENT_STATUS, type AppointmentStatus } from "@/lib/appointments"

export type UpcomingAppointment = {
  id: string
  title: string
  starts_at: string
  status: AppointmentStatus
  patient: { name: string } | null
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function UpcomingAppointments({ appointments }: { appointments: UpcomingAppointment[] }) {
  return (
    <div className="flex h-full flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-muted-foreground" /> Próximas citas
        </div>
        <Link href="/dashboard/calendario" className="text-xs text-primary hover:underline">
          Ver agenda
        </Link>
      </div>

      {appointments.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">No hay citas próximas.</p>
          <Link href="/dashboard/calendario" className="text-xs text-primary hover:underline">
            Agendar una cita
          </Link>
        </div>
      ) : (
        <ul className="divide-y">
          {appointments.map((a) => {
            const meta = APPOINTMENT_STATUS[a.status]
            return (
              <li key={a.id}>
                <Link
                  href="/dashboard/calendario"
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {a.patient?.name ? `${a.patient.name} · ` : ""}
                      {a.title}
                    </div>
                    <div className="text-xs text-muted-foreground">{fmt(a.starts_at)}</div>
                  </div>
                  {meta && (
                    <span
                      className="hidden size-2 shrink-0 rounded-full sm:block"
                      style={{ backgroundColor: meta.color }}
                      aria-label={meta.label}
                    />
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

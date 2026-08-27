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

// Anclada a America/Bogota: se renderiza en el servidor (runtime UTC en Vercel), así que sin
// `timeZone` una cita de las 19:00 aparecía en el día siguiente y a la hora equivocada.
function fmt(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso))
}

export function UpcomingAppointments({ appointments }: { appointments: UpcomingAppointment[] }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-line-soft bg-panel">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {/* El azul de la agenda — el mismo de las pastillas de citas. */}
          <CalendarClock aria-hidden className="size-4" style={{ color: "var(--chart-5)" }} /> Próximas citas
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
        // Techo + scroll propio: con las 8 citas que trae la página, la lista medía ~450 px y era
        // ella la que estiraba la fila gráfico/citas del tablero — el scroll le pertenece a la
        // lista, no a la página. 288 px (~5 filas) empareja el panel con el alto del gráfico.
        <ul className="max-h-72 divide-y overflow-y-auto">
          {appointments.map((a) => {
            const meta = APPOINTMENT_STATUS[a.status]
            return (
              <li key={a.id}>
                <Link
                  href="/dashboard/calendario"
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-card"
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

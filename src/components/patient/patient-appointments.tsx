// Citas del paciente — registro de solo lectura dentro de su ficha.
//
// Las citas ya se guardaban con su paciente, titular y veterinario, pero solo se veían en la grilla
// del Calendario: abriendo la ficha de una mascota no había forma de saber cuándo vino ni cuándo
// vuelve. Esta sección es ese registro, al lado de vacunas y consultas, que es donde se mira la
// historia del paciente.
//
// Agendar sigue siendo cosa del Calendario: acá no se crea ni se edita nada.

import Link from "next/link"

import { APPOINTMENT_STATUS, type AppointmentStatus } from "@/lib/appointments"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

export type PatientAppointment = {
  id: string
  title: string
  reason: string | null
  status: AppointmentStatus
  starts_at: string
  vet: { full_name: string | null } | null
}

function fmtFecha(iso: string): string {
  // `timeZone` explícito: este componente es de SERVIDOR y en Vercel el proceso vive en UTC —
  // sin él, la ficha mostraba cada cita corrida 5 horas (la de las 14:00 salía «19:00»).
  return new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Bogota",
  })
}

export function PatientAppointments({
  appointments,
  // El "ahora" llega calculado desde la página en vez de leerse acá: durante el render es impuro
  // (dos renders darían resultados distintos), y la regla de React lo prohíbe.
  nowIso,
}: {
  appointments: PatientAppointment[]
  nowIso: string
}) {
  if (appointments.length === 0) {
    return (
      <EmptyState
        title="Sin citas todavía"
        description="Cuando agendes una cita para este paciente, va a quedar registrada acá."
        action={
          <Button variant="outline" size="sm" render={<Link href="/dashboard/calendario" />}>
            Ir al calendario
          </Button>
        }
      />
    )
  }

  const ahora = new Date(nowIso).getTime()

  return (
    <div className="flex flex-col gap-1.5">
      {appointments.map((a) => {
        const meta = APPOINTMENT_STATUS[a.status]
        const futura = new Date(a.starts_at).getTime() >= ahora
        return (
          <div
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{fmtFecha(a.starts_at)}</span>
                {futura && (
                  <Badge variant="secondary" className="text-[10px]">
                    Próxima
                  </Badge>
                )}
              </div>
              <p className="line-clamp-1 text-xs text-muted-foreground">
                {a.reason || a.title}
                {a.vet?.full_name ? ` · ${a.vet.full_name}` : ""}
              </p>
            </div>
            {/* El color viene del mismo mapa que pinta los bloques del calendario, para que un
                estado se lea igual en las dos pantallas. */}
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
              style={{ backgroundColor: meta.color }}
            >
              {meta.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

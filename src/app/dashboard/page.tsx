import { addWeeks, format, startOfWeek } from "date-fns"
import { es } from "date-fns/locale"
import { CalendarClock, FileClock, PawPrint, Stethoscope } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { SectionCards } from "@/components/section-cards"
import { ConsultationsChart } from "@/components/dashboard/consultations-chart"
import {
  UpcomingAppointments,
  type UpcomingAppointment,
} from "@/components/dashboard/upcoming-appointments"

const WEEKS = 12

// Agrupa las fechas de consulta en 12 buckets semanales (lun–dom) para el gráfico.
function weeklySeries(dates: string[]): { label: string; count: number }[] {
  const base = startOfWeek(new Date(), { weekStartsOn: 1 })
  const buckets = Array.from({ length: WEEKS }, (_, i) => {
    const start = startOfWeek(addWeeks(base, i - (WEEKS - 1)), { weekStartsOn: 1 })
    return { start, label: format(start, "d MMM", { locale: es }), count: 0 }
  })
  for (const iso of dates) {
    const wk = startOfWeek(new Date(iso), { weekStartsOn: 1 }).getTime()
    const b = buckets.find((x) => x.start.getTime() === wk)
    if (b) b.count += 1
  }
  return buckets.map(({ label, count }) => ({ label, count }))
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const weekAhead = new Date(now.getTime() + 7 * 864e5)
  const chartStart = startOfWeek(addWeeks(startOfWeek(now, { weekStartsOn: 1 }), -(WEEKS - 1)), {
    weekStartsOn: 1,
  })

  const [consultasMes, pacientes, citas7d, notasRevisar, chartData, upcomingData] =
    await Promise.all([
      supabase
        .from("consultations")
        .select("*", { count: "exact", head: true })
        .gte("started_at", monthStart.toISOString()),
      supabase.from("patients").select("*", { count: "exact", head: true }),
      supabase
        .from("appointments")
        .select("*", { count: "exact", head: true })
        .gte("starts_at", now.toISOString())
        .lte("starts_at", weekAhead.toISOString())
        .neq("status", "canceled"),
      supabase.from("clinical_notes").select("*", { count: "exact", head: true }).eq("status", "draft"),
      supabase
        .from("consultations")
        .select("started_at")
        .gte("started_at", chartStart.toISOString()),
      supabase
        .from("appointments")
        .select("id, title, starts_at, status, patient:patients(name)")
        .gte("starts_at", now.toISOString())
        .neq("status", "canceled")
        .order("starts_at", { ascending: true })
        .limit(8),
    ])

  const metrics = [
    {
      label: "Consultas este mes",
      value: consultasMes.count ?? 0,
      hint: "Consultas registradas en la clínica",
      icon: <Stethoscope className="size-4 text-muted-foreground" />,
    },
    {
      label: "Pacientes",
      value: pacientes.count ?? 0,
      hint: "Fichas activas en la clínica",
      icon: <PawPrint className="size-4 text-muted-foreground" />,
    },
    {
      label: "Citas (próx. 7 días)",
      value: citas7d.count ?? 0,
      hint: "Agenda de la semana",
      icon: <CalendarClock className="size-4 text-muted-foreground" />,
    },
    {
      label: "Notas por revisar",
      value: notasRevisar.count ?? 0,
      hint: "Borradores del Modo Fantasma pendientes de aprobar",
      icon: <FileClock className="size-4 text-muted-foreground" />,
      help: "El Modo Fantasma redacta la nota de cada consulta como borrador. Ninguna entra a la historia clínica hasta que un veterinario la revisa y aprueba.",
    },
  ]

  const series = weeklySeries(
    ((chartData.data as { started_at: string }[] | null) ?? []).map((c) => c.started_at),
  )
  const upcoming = (upcomingData.data as unknown as UpcomingAppointment[] | null) ?? []

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <SectionCards metrics={metrics} />
      <div className="grid gap-4 px-4 lg:grid-cols-5 lg:px-6">
        <div className="lg:col-span-3">
          <ConsultationsChart data={series} />
        </div>
        <div className="lg:col-span-2">
          <UpcomingAppointments appointments={upcoming} />
        </div>
      </div>
    </div>
  )
}

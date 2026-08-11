import { addWeeks, format, startOfWeek } from "date-fns"
import { es } from "date-fns/locale/es"

import { createClient } from "@/lib/supabase/server"
import { DataError } from "@/components/data-error"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { StatCard } from "@/components/ui/stat-card"
import { ConsultationsChartLazy as ConsultationsChart } from "@/components/dashboard/consultations-chart-lazy"
import { BorrarEjemplo } from "@/components/onboarding/borrar-ejemplo"
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

  const [consultasMes, pacientes, citas7d, notasRevisar, chartData, upcomingData, demoOwner] =
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
        // Solo estados realmente pendientes: una cita futura marcada completed/no_show no es "próxima".
        .in("status", ["scheduled", "confirmed", "in_progress"]),
      supabase.from("clinical_notes").select("*", { count: "exact", head: true }).eq("status", "draft"),
      supabase
        .from("consultations")
        .select("started_at")
        .gte("started_at", chartStart.toISOString()),
      supabase
        .from("appointments")
        .select("id, title, starts_at, status, patient:patients(name)")
        .gte("starts_at", now.toISOString())
        .in("status", ["scheduled", "confirmed", "in_progress"])
        .order("starts_at", { ascending: true })
        .limit(8),
      // Lo único que queda del viejo checklist: si hay datos de ejemplo, se ofrece borrarlos. Los
      // conteos de audios y notas aprobadas que alimentaban sus otros dos checks se fueron con él —
      // medían USO, y el riel que lo reemplazó mide CONFIGURACIÓN.
      supabase
        .from("owners")
        .select("*", { count: "exact", head: true })
        .eq("full_name", "Ejemplo — TuvetIA"),
    ])

  // Un fallo de query no debe verse como "clínica en ceros": banner de error visible.
  const loadError = [consultasMes, pacientes, citas7d, notasRevisar, chartData, upcomingData].some(
    (r) => r.error,
  )

  const metrics = [
    {
      label: "Consultas este mes",
      value: consultasMes.count ?? 0,
      hint: "Consultas registradas en la clínica",
    },
    {
      label: "Pacientes",
      value: pacientes.count ?? 0,
      hint: "Fichas activas en la clínica",
    },
    {
      label: "Citas (próx. 7 días)",
      value: citas7d.count ?? 0,
      hint: "Agenda de la semana",
    },
    {
      label: "Notas por revisar",
      value: notasRevisar.count ?? 0,
      hint: "Borradores del Modo Fantasma pendientes de aprobar",
    },
  ]

  const series = weeklySeries(
    ((chartData.data as { started_at: string }[] | null) ?? []).map((c) => c.started_at),
  )
  const upcoming = (upcomingData.data as unknown as UpcomingAppointment[] | null) ?? []

  const hoy = new Date().toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  })

  return (
    // Pasa a `PageShell` como el resto del CRM. Antes tenía su propio marco —`py-4` afuera y
    // `px-4 lg:px-6` repetido en CADA hijo—, que es de donde salía que el tablero no se alineara
    // con ninguna otra pantalla.
    <PageShell>
      <PageHeader
        title="Dashboard"
        description={`${hoy.charAt(0).toUpperCase() + hoy.slice(1)} · la clínica de un vistazo`}
      />
      {loadError && (
        <DataError>
          Algunas métricas no se pudieron cargar y pueden verse en cero. Recargá la página.
        </DataError>
      )}
      {/* `auto-fit` + `minmax(220px,1fr)` es la grilla del mockup: las tarjetas se acomodan solas
          según el ancho en vez de saltar de 2 a 4 columnas en un breakpoint fijo. */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {metrics.map((m) => (
          <StatCard key={m.label} label={m.label} value={String(m.value)} sub={m.hint} />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ConsultationsChart data={series} />
        </div>
        <div className="lg:col-span-2">
          <UpcomingAppointments appointments={upcoming} />
        </div>
      </div>
      {(demoOwner.count ?? 0) > 0 && <BorrarEjemplo />}
    </PageShell>
  )
}

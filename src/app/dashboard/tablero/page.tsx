import { addWeeks, format, startOfWeek } from "date-fns"
import { es } from "date-fns/locale/es"

import { createClient } from "@/lib/supabase/server"
import { DataError } from "@/components/data-error"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import {
  PastillasDelTablero,
  type Pastilla,
} from "@/components/dashboard/pastillas-del-tablero"
import { ConsultationsChartLazy as ConsultationsChart } from "@/components/dashboard/consultations-chart-lazy"
import { BorrarEjemplo } from "@/components/onboarding/borrar-ejemplo"
import { RielConfiguracion } from "@/components/onboarding/riel-configuracion"
import { progresoDeConfiguracion } from "@/lib/onboarding/consultar"
import {
  UpcomingAppointments,
  type UpcomingAppointment,
} from "@/components/dashboard/upcoming-appointments"

export const metadata = { title: "Dashboard · Tuvetia" }

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

  // CADA CIFRA LLEVA SU CLAVE DE DETALLE. Es lo que la vuelve tocable: al abrirla, la vista pide
  // `/api/tablero/detalle?metrica=…`, que consulta CON LOS MISMOS FILTROS que el conteo de acá
  // arriba — si los dos lados se separan, el detalle termina contradiciendo a la cifra que lo abrió.
  const metrics: Pastilla[] = [
    {
      metrica: "consultas-mes",
      label: "Consultas este mes",
      value: String(consultasMes.count ?? 0),
      hint: "Consultas registradas en la clínica",
    },
    {
      metrica: "pacientes",
      label: "Pacientes",
      value: String(pacientes.count ?? 0),
      hint: "Fichas activas en la clínica",
    },
    {
      metrica: "citas-7d",
      label: "Citas (próx. 7 días)",
      value: String(citas7d.count ?? 0),
      hint: "Agenda de la semana",
    },
    {
      metrica: "notas-borrador",
      label: "Notas por revisar",
      value: String(notasRevisar.count ?? 0),
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
      {/* EL RIEL DE CONFIGURACIÓN VUELVE ACÁ, ARRIBA DE TODO.
          Estuvo un tiempo en la pantalla de Athos, cuando ésa era la puerta de entrada. Se movió
          por dos razones: abierto empujaba hacia abajo el chat entero —la conversación arrancaba
          fuera de la pantalla, que es lo peor que le podés hacer a la superficie principal— y
          además el Dashboard volvió a ser lo primero que se ve al entrar, así que acá vuelve a
          cumplir su función de recordar.
          Es el MISMO componente y la misma lógica: sólo cambió de lugar. */}
      <RielConfiguracion progreso={await progresoDeConfiguracion()} />
      <PastillasDelTablero pastillas={metrics} />
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

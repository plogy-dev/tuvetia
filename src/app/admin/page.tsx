import { Activity, AudioLines, Building2, MessageCircle, PawPrint, Stethoscope, Users } from "lucide-react"
import { addWeeks, format, startOfWeek } from "date-fns"
import { es } from "date-fns/locale"

import { loadPlatformMetrics, daysAgo, since } from "@/lib/admin/metrics"
import { SectionCards } from "@/components/section-cards"
import { ConsultationsChart } from "@/components/dashboard/consultations-chart"

export const metadata = { title: "Admin · TuvetIA" }

const WEEKS = 12

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

export default async function AdminResumenPage() {
  const m = await loadPlatformMetrics()
  const d30 = daysAgo(30)

  const minutes30d = Math.round(
    since(m.audios, d30).reduce((s, a) => s + (a.duration_secs ?? 0), 0) / 60,
  )

  const metrics = [
    { label: "Clínicas", value: m.clinics.length, hint: "Tenants registrados", icon: <Building2 className="size-4 text-muted-foreground" /> },
    { label: "Usuarios", value: m.profiles.length, hint: "Perfiles totales", icon: <Users className="size-4 text-muted-foreground" /> },
    { label: "Pacientes", value: m.patients.length, hint: "Fichas en toda la plataforma", icon: <PawPrint className="size-4 text-muted-foreground" /> },
    { label: "Consultas (30d)", value: since(m.consultations, d30).length, hint: `${m.consultations.length} históricas`, icon: <Stethoscope className="size-4 text-muted-foreground" /> },
    { label: "Mensajes Athos (30d)", value: since(m.messages, d30).length, hint: `${m.messages.length} históricos`, icon: <Activity className="size-4 text-muted-foreground" /> },
    { label: "Min. transcritos (30d)", value: minutes30d, hint: "Audio procesado por Deepgram", icon: <AudioLines className="size-4 text-muted-foreground" /> },
    { label: "Notas clínicas", value: m.notes.length, hint: `${m.notes.filter((n) => n.status === "approved").length} aprobadas`, icon: <Stethoscope className="size-4 text-muted-foreground" /> },
    { label: "WhatsApp", value: m.waIntegrations.filter((w) => w.status === "connected").length, hint: `${m.waMessages.length} mensajes · ${m.waIntegrations.length} clínicas iniciaron conexión`, icon: <MessageCircle className="size-4 text-muted-foreground" /> },
  ]

  const activity = weeklySeries([
    ...m.consultations.map((c) => c.started_at),
    ...m.messages.map((x) => x.created_at),
  ])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Resumen de plataforma</h1>
      {/* wrapper @container/main: las tarjetas usan container queries de ese nombre */}
      <div className="@container/main -mx-4">
        <SectionCards metrics={metrics} />
      </div>
      <ConsultationsChart data={activity} />
      <p className="text-xs text-muted-foreground">
        El gráfico suma consultas + mensajes del Copiloto por semana (12 semanas), todas las clínicas.
      </p>
    </div>
  )
}

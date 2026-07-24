import { loadPlatformMetrics, daysAgo, since, countBy } from "@/lib/admin/metrics"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const metadata = { title: "Admin · Clínicas" }

export default async function AdminClinicasPage() {
  const m = await loadPlatformMetrics()
  const d30 = daysAgo(30)

  const rows = m.clinics
    .map((c) => {
      const msgs = m.messages.filter((x) => x.clinic_id === c.id)
      // Pico de mensajes/día (30d): la señal de "rate limit" para detectar abuso.
      const perDay = countBy(since(msgs, d30), (x) => x.created_at.slice(0, 10))
      const peak = Math.max(0, ...perDay.values())
      const lastDates = [
        ...m.consultations.filter((x) => x.clinic_id === c.id).map((x) => x.started_at),
        ...msgs.map((x) => x.created_at),
      ]
      const wa = m.waIntegrations.find((w) => w.clinic_id === c.id)
      return {
        id: c.id,
        name: c.name,
        users: m.profiles.filter((p) => p.clinic_id === c.id).length,
        patients: m.patients.filter((p) => p.clinic_id === c.id).length,
        consultas30: since(m.consultations.filter((x) => x.clinic_id === c.id), d30).length,
        msgs30: since(msgs, d30).length,
        peakDay: peak,
        notas: m.notes.filter((n) => n.clinic_id === c.id).length,
        wa: wa?.status === "connected" ? (wa.phone_number ?? "sí") : wa ? "pendiente" : "—",
        last: lastDates.length ? lastDates.sort().at(-1)!.slice(0, 10) : "—",
      }
    })
    .sort((a, b) => b.msgs30 - a.msgs30)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Clínicas ({rows.length})</h1>
        <p className="text-sm text-muted-foreground">
          Actividad por tenant. <b>Pico msgs/día</b> (últimos 30 días) es la señal de uso intensivo —
          el enforcement de rate limits está en el backlog.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Clínica</TableHead>
              <TableHead className="text-right">Usuarios</TableHead>
              <TableHead className="text-right">Pacientes</TableHead>
              <TableHead className="text-right">Consultas 30d</TableHead>
              <TableHead className="text-right">Msgs Athos 30d</TableHead>
              <TableHead className="text-right">Pico msgs/día</TableHead>
              <TableHead className="text-right">Notas</TableHead>
              <TableHead>WhatsApp</TableHead>
              <TableHead>Última actividad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right">{r.users}</TableCell>
                <TableCell className="text-right">{r.patients}</TableCell>
                <TableCell className="text-right">{r.consultas30}</TableCell>
                <TableCell className="text-right">{r.msgs30}</TableCell>
                <TableCell className="text-right">{r.peakDay}</TableCell>
                <TableCell className="text-right">{r.notas}</TableCell>
                <TableCell>{r.wa}</TableCell>
                <TableCell className="text-muted-foreground">{r.last}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

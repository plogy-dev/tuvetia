import { loadPlatformMetrics, daysAgo, since } from "@/lib/admin/metrics"
import { PRICING, fmtUsd } from "@/lib/admin/pricing"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const metadata = { title: "Admin · Costos" }

export default async function AdminCostosPage() {
  const m = await loadPlatformMetrics()
  const d30 = daysAgo(30)

  // Uso variable de los últimos 30 días → estimación mensual.
  const answers30 = since(m.answers, d30)
  const retrievals30 = since(m.retrievals, d30)
  const minutes30 = since(m.audios, d30).reduce((s, a) => s + (a.duration_secs ?? 0), 0) / 60

  const llmCost = answers30.length * PRICING.llmPerCall
  const retrievalCost = retrievals30.length * PRICING.coherePerRetrieval
  const deepgramCost = minutes30 * PRICING.deepgramPerMinute
  const variable = llmCost + retrievalCost + deepgramCost
  const fixed =
    PRICING.railwayMonthly + PRICING.vercelMonthly + PRICING.supabaseMonthly +
    (m.waIntegrations.length > 0 ? PRICING.kapsoMonthly : 0)
  const total = variable + fixed

  const lines: { concepto: string; detalle: string; costo: number }[] = [
    { concepto: "LLM (DeepSeek)", detalle: `${answers30.length} generaciones × ${fmtUsd(PRICING.llmPerCall)}`, costo: llmCost },
    { concepto: "Embeddings (Cohere)", detalle: `${retrievals30.length} retrievals × ${fmtUsd(PRICING.coherePerRetrieval)}`, costo: retrievalCost },
    { concepto: "Transcripción (Deepgram)", detalle: `${minutes30.toFixed(1)} min × ${fmtUsd(PRICING.deepgramPerMinute)}`, costo: deepgramCost },
    { concepto: "Railway (backend Athos)", detalle: "fijo mensual", costo: PRICING.railwayMonthly },
    { concepto: "Vercel (front)", detalle: "plan free", costo: PRICING.vercelMonthly },
    { concepto: "Supabase (DB)", detalle: "free tier (→ $25 al migrar el corpus)", costo: PRICING.supabaseMonthly },
    ...(m.waIntegrations.length > 0
      ? [{ concepto: "Kapso (WhatsApp)", detalle: "plan base", costo: PRICING.kapsoMonthly }]
      : []),
  ]

  // Desglose por clínica del costo variable (proporcional a su uso).
  const perClinic = m.clinics
    .map((c) => {
      const a = since(m.answers.filter((x) => x.clinic_id === c.id), d30).length
      const r = since(m.retrievals.filter((x) => x.clinic_id === c.id), d30).length
      const min = since(m.audios.filter((x) => x.clinic_id === c.id), d30)
        .reduce((s, x) => s + (x.duration_secs ?? 0), 0) / 60
      return {
        name: c.name,
        cost: a * PRICING.llmPerCall + r * PRICING.coherePerRetrieval + min * PRICING.deepgramPerMinute,
        detail: `${a} gen · ${r} retr · ${min.toFixed(1)} min`,
      }
    })
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Costos operacionales (estimados)</h1>
        <p className="text-sm text-muted-foreground">
          Uso de los últimos 30 días × precios unitarios de <code>src/lib/admin/pricing.ts</code>.
          Es una <b>estimación</b> (los logs no guardan tokens); la factura real vive en cada proveedor.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Concepto</TableHead>
              <TableHead>Detalle</TableHead>
              <TableHead className="text-right">USD/mes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.concepto}>
                <TableCell className="font-medium">{l.concepto}</TableCell>
                <TableCell className="text-muted-foreground">{l.detalle}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(l.costo)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-semibold">Total estimado</TableCell>
              <TableCell className="text-muted-foreground">
                variable {fmtUsd(variable)} + fijo {fmtUsd(fixed)}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{fmtUsd(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-semibold">Costo variable por clínica (30d)</div>
        {perClinic.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin uso variable en los últimos 30 días.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {perClinic.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.detail}</span>
                <span className="tabular-nums">{fmtUsd(c.cost)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

import { loadPlatformMetrics, daysAgo, since, countBy } from "@/lib/admin/metrics"
import { PRICING, costoTokens, fmtUsd } from "@/lib/admin/pricing"
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
  const usage30 = since(m.agentUsage, d30)
  const minutes30 = since(m.audios, d30).reduce((s, a) => s + (a.duration_secs ?? 0), 0) / 60

  // ── athos-service: ESTIMACIÓN por llamada, agrupada POR MODELO ────────────────────────────────
  // Antes se rotulaba todo como "LLM (DeepSeek)" y se le aplicaba una tarifa única. Con la cascada
  // activa el modelo varía por llamada, y ese dato ya estaba en `rag_answer_log.model`.
  const porModelo = countBy(answers30, (a) => a.model)
  const lineasLlm = [...porModelo.entries()]
    .map(([modelo, llamadas]) => {
      const tarifa = PRICING.llmPorLlamada[modelo] ?? PRICING.llmPorLlamadaDefecto
      return {
        concepto: `LLM · ${modelo}`,
        detalle: `${llamadas} generaciones × ${fmtUsd(tarifa)} (estimado)`,
        costo: llamadas * tarifa,
      }
    })
    .sort((a, b) => b.costo - a.costo)
  const llmCost = lineasLlm.reduce((s, l) => s + l.costo, 0)

  // ── Agente de Next: costo REAL por tokens (migración 0046) ────────────────────────────────────
  // Este consumo era INVISIBLE hasta ahora: el agente con herramientas, la sugerencia de WhatsApp,
  // el modo auto y la visión de facturas llaman a Anthropic desde Next y no dejaban rastro.
  // Se agrupa por (PROVEEDOR, modelo), no sólo por modelo: la tarifa depende de quién cobra, y con
  // la cascada activa el mismo turno puede haberlo respondido cualquiera de los tres.
  const porModeloAgente = new Map<
    string,
    { provider: string | null; model: string; llamadas: number; tin: number; tout: number }
  >()
  for (const u of usage30) {
    const clave = `${u.provider ?? "?"}·${u.model}`
    const cur = porModeloAgente.get(clave) ?? {
      provider: u.provider ?? null,
      model: u.model,
      llamadas: 0,
      tin: 0,
      tout: 0,
    }
    cur.llamadas += 1
    cur.tin += u.tokens_in ?? 0
    cur.tout += u.tokens_out ?? 0
    porModeloAgente.set(clave, cur)
  }
  const lineasAgente = [...porModeloAgente.values()]
    .map((v) => {
      const { usd, tarifado } = costoTokens(v.provider, v.model, v.tin, v.tout)
      const tokens = `${(v.tin / 1000).toFixed(1)}k in / ${(v.tout / 1000).toFixed(1)}k out`
      return {
        concepto: `Agente Next · ${v.model}`,
        detalle: tarifado
          ? `${v.llamadas} llamadas · ${tokens} — costo real`
          : `${v.llamadas} llamadas · ${tokens} — SIN TARIFA CARGADA para ${v.provider ?? "proveedor desconocido"}, no suma al total`,
        costo: usd,
      }
    })
    .sort((a, b) => b.costo - a.costo)
  const agenteCost = lineasAgente.reduce((s, l) => s + l.costo, 0)
  // Cuántas llamadas quedaron fuera del total por falta de tarifa. Es lo que convierte el total en
  // una cifra honesta: sin esto, un proveedor sin tarifa se vería como "gastó cero".
  const sinTarifa = [...porModeloAgente.values()].filter(
    (v) => !costoTokens(v.provider, v.model, 0, 0).tarifado,
  )
  const respaldos30 = usage30.filter((u) => u.fell_back_from).length

  const retrievalCost = retrievals30.length * PRICING.coherePerRetrieval
  const rerankCost = retrievals30.length * PRICING.cohereRerankPerRetrieval
  const deepgramCost = minutes30 * PRICING.deepgramPerMinute

  const variable = llmCost + agenteCost + retrievalCost + rerankCost + deepgramCost
  const fixed = PRICING.railwayMonthly + PRICING.vercelMonthly + PRICING.supabaseMonthly
  const total = variable + fixed

  const lines: { concepto: string; detalle: string; costo: number }[] = [
    ...lineasLlm,
    ...lineasAgente,
    { concepto: "Embeddings (Cohere)", detalle: `${retrievals30.length} retrievals × ${fmtUsd(PRICING.coherePerRetrieval)}`, costo: retrievalCost },
    { concepto: "Rerank (Cohere)", detalle: `${retrievals30.length} búsquedas × ${fmtUsd(PRICING.cohereRerankPerRetrieval)}`, costo: rerankCost },
    { concepto: "Transcripción (Deepgram)", detalle: `${minutes30.toFixed(1)} min × ${fmtUsd(PRICING.deepgramPerMinute)}`, costo: deepgramCost },
    { concepto: "Railway", detalle: "backend Athos + Evolution + su Postgres — sin facturar todavía", costo: PRICING.railwayMonthly },
    { concepto: "Vercel (front)", detalle: "plan Hobby", costo: PRICING.vercelMonthly },
    { concepto: "Supabase (DB)", detalle: "plan Pro — el único proveedor de infra que se paga hoy", costo: PRICING.supabaseMonthly },
  ]

  // Desglose por clínica del costo variable (proporcional a su uso).
  const perClinic = m.clinics
    .map((c) => {
      const gen = since(m.answers.filter((x) => x.clinic_id === c.id), d30)
      const genCost = gen.reduce(
        (s, a) => s + (PRICING.llmPorLlamada[a.model ?? ""] ?? PRICING.llmPorLlamadaDefecto),
        0,
      )
      const r = since(m.retrievals.filter((x) => x.clinic_id === c.id), d30).length
      const min = since(m.audios.filter((x) => x.clinic_id === c.id), d30)
        .reduce((s, x) => s + (x.duration_secs ?? 0), 0) / 60
      const agente = since(m.agentUsage.filter((x) => x.clinic_id === c.id), d30)
      const agenteC = agente.reduce(
        (s, u) => s + costoTokens(u.provider, u.model, u.tokens_in ?? 0, u.tokens_out ?? 0).usd,
        0,
      )
      return {
        name: c.name,
        cost:
          genCost +
          agenteC +
          r * (PRICING.coherePerRetrieval + PRICING.cohereRerankPerRetrieval) +
          min * PRICING.deepgramPerMinute,
        detail: `${gen.length} gen · ${agente.length} agente · ${r} retr · ${min.toFixed(1)} min`,
      }
    })
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Costos operacionales</h1>
        <p className="text-sm text-muted-foreground">
          Uso de los últimos 30 días. Las líneas de <b>Agente Next</b> son el costo <b>real</b>{" "}
          (tokens medidos); el resto son <b>estimaciones</b> por número de llamadas × tarifa de{" "}
          <code>src/lib/admin/pricing.ts</code>, porque <code>rag_answer_log</code> todavía no guarda
          tokens. La factura real vive en cada proveedor.
        </p>
      </div>

      {sinTarifa.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <b>El total está incompleto.</b> Hay consumo de{" "}
          {[...new Set(sinTarifa.map((v) => v.provider ?? "proveedor desconocido"))].join(", ")} sin
          tarifa por token cargada, así que esas llamadas se listan pero <b>no suman</b>. Se cargan en{" "}
          <code>TOKENS_POR_MILLON</code> de <code>src/lib/admin/pricing.ts</code>. Van vacías a
          propósito: antes se cobraban a tarifa de Anthropic —del orden de 10× de más para DeepSeek—
          bajo un rótulo que dice «costo real».
        </div>
      )}

      {m.agentUsage.length === 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <b>El consumo del agente de Next no se está registrando.</b> Falta aplicar la migración{" "}
          <code>0046_athos_agent_usage.sql</code> al proyecto principal. Hasta entonces, el gasto de
          Anthropic del asistente, del modo auto de WhatsApp y de la lectura de facturas{" "}
          <b>no aparece en esta tabla</b> — el total de abajo lo subestima.
        </div>
      )}

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
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="text-muted-foreground">
                variable {fmtUsd(variable)} + fijo {fmtUsd(fixed)}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{fmtUsd(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {respaldos30 > 0 && (
        <p className="text-xs text-muted-foreground">
          La cascada entró {respaldos30} {respaldos30 === 1 ? "vez" : "veces"} en los últimos 30 días
          (el proveedor primario falló y respondió el respaldo). Esas llamadas están cobradas al
          modelo que de verdad respondió.
        </p>
      )}

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

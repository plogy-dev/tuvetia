import { requerirAdminDePlataforma } from "@/lib/platform-admin"
import { loadPlatformMetrics, daysAgo, since, countBy } from "@/lib/admin/metrics"

export const metadata = { title: "Admin · Uso IA" }

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function BreakdownCard({ title, entries }: { title: string; entries: [string, number][] }) {
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin datos.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {entries
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => (
              <li key={k} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{k}</span>
                <span className="tabular-nums text-muted-foreground">{n}</span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((n / total) * 100)}%` }}
                  />
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

export default async function AdminUsoPage() {
  // ANTES DE CONSULTAR NADA: el layout no alcanza, la página se renderiza en paralelo y sus
  // datos se serializan en la respuesta aunque el layout devuelva 404. Ver `lib/platform-admin`.
  await requerirAdminDePlataforma()

  const m = await loadPlatformMetrics()
  const d30 = daysAgo(30)

  const answers30 = since(m.answers, d30)
  const retrievals30 = since(m.retrievals, d30)
  const audios30 = since(m.audios, d30)

  const minutes30 = Math.round(audios30.reduce((s, a) => s + (a.duration_secs ?? 0), 0) / 60)
  const storageMb = Math.round(m.audios.reduce((s, a) => s + (a.file_size ?? 0), 0) / 1e6)

  // Agente de Next (migración 0046): el único camino que sí registra TOKENS.
  const agente30 = since(m.agentUsage, d30)
  const tokens30 = agente30.reduce((s, u) => s + (u.tokens_in ?? 0) + (u.tokens_out ?? 0), 0)
  const respaldos30 = agente30.filter((u) => u.fell_back_from).length

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Uso de IA (30 días)</h1>
        <p className="text-sm text-muted-foreground">
          Generaciones (chat + Modo Fantasma), retrieval y transcripción, todas las clínicas.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Generaciones LLM" value={answers30.length} hint={`${m.answers.length} históricas`} />
        <Stat label="Retrievals" value={retrievals30.length} hint={`${m.retrievals.length} históricos`} />
        <Stat label="Minutos Deepgram" value={minutes30} hint={`${m.audios.length} audios totales`} />
        <Stat
          label="Tokens del agente"
          value={tokens30 >= 1000 ? `${(tokens30 / 1000).toFixed(1)}k` : tokens30}
          hint={`${agente30.length} llamadas${respaldos30 > 0 ? ` · ${respaldos30} por respaldo` : ""}`}
        />
        <Stat label="Storage de audio" value={`${storageMb} MB`} hint="se purga a 4 días" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownCard
          title="Generaciones por modelo (histórico)"
          entries={[...countBy(m.answers, (a) => a.model ?? "desconocido").entries()]}
        />
        <BreakdownCard
          title="Retrievals por tier alcanzado (histórico)"
          entries={[...countBy(m.retrievals, (r) => r.tier_reached ?? "—").entries()]}
        />
        <BreakdownCard
          title="Agente de Next por superficie (30d)"
          entries={[...countBy(agente30, (u) => u.surface).entries()]}
        />
        <BreakdownCard
          title="Agente de Next por modelo (30d)"
          entries={[...countBy(agente30, (u) => u.model).entries()]}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {m.agentUsage.length === 0 ? (
          <>
            <b>El agente de Next todavía no registra nada:</b> falta aplicar la migración{" "}
            <code>0046_athos_agent_usage.sql</code> al principal. Hasta entonces, el consumo del
            asistente, del modo auto de WhatsApp y de la lectura de facturas es invisible acá.
          </>
        ) : (
          <>
            Sólo el <b>agente de Next</b> registra tokens (tabla <code>athos_agent_usage</code>): su
            costo en la pestaña Costos es real. Lo de <code>rag_answer_log</code> (chat clínico y
            Modo Fantasma) sigue sin tokens — volúmenes exactos, costo estimado. Mejora anotada:
            loguear <code>tokens_in/out</code> también ahí.
          </>
        )}
      </p>
    </div>
  )
}

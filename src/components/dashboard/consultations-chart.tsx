"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

export function ConsultationsChart({ data }: { data: { label: string; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="flex h-full flex-col rounded-xl border bg-card p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold">Consultas por semana</div>
        <div className="text-xs text-muted-foreground">Últimas 12 semanas · {total} en total</div>
      </div>
      {total === 0 ? (
        <div className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
          Todavía no hay consultas registradas.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={28} />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--foreground)" }}
              formatter={(value) => [value, "Consultas"]}
            />
            <Bar dataKey="count" className="fill-primary" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

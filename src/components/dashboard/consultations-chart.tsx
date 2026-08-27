"use client"

import Link from "next/link"
import { Stethoscope } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

export function ConsultationsChart({ data }: { data: { label: string; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-4">
      <div className="mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {/* El icono lleva el MISMO tono que las barras y que la pastilla de consultas: es la
              identidad del dominio clínico en todo el tablero, no un adorno por panel. */}
          <Stethoscope aria-hidden className="size-4" style={{ color: "var(--chart-1)" }} />
          Consultas por semana
        </div>
        <div className="text-xs text-muted-foreground">Últimas 12 semanas · {total} en total</div>
      </div>
      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <p className="text-sm text-muted-foreground">Todavía no hay consultas registradas.</p>
          <Link href="/dashboard/consultas" className="text-xs text-primary hover:underline">
            Empezar la primera
          </Link>
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
            {/* var(--chart-1) y no fill-primary: el primario es el color de ACCION del sistema (botones);
              las series usan la paleta categorica validada, la misma de la dona. */}
            {/* LA SEMANA EN CURSO, ENCENDIDA; las pasadas, atenuadas al mismo tono. Es énfasis del
                extremo, no una segunda serie: la pregunta del panel es «¿cómo viene ESTA semana
                contra el historial?», y doce barras idénticas obligan a buscar la última con la
                vista. La atenuación es del fill, no del token — impresa en gris sigue leyéndose. */}
            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={36}>
              {data.map((d, i) => (
                <Cell key={d.label} fill="var(--chart-1)" fillOpacity={i === data.length - 1 ? 1 : 0.45} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

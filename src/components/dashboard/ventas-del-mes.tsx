"use client"

import Link from "next/link"
import { Banknote } from "lucide-react"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"

import { formatCOP } from "@/lib/facturacion/format"
import type { VentaPorTipo } from "@/lib/tablero/ventas-por-tipo"

// La dona de ventas del mes — el bloque con color que pidió David (25-ago, captura de OkVet).
//
// ── LAS DECISIONES DE FORMA, Y POR QUÉ ────────────────────────────────────────────────────────
//
// · DONA Y NO TORTA: el hueco deja el total del mes en el centro, que es el número que se viene a
//   ver; los gajos son el desglose. Dos lecturas en un solo bloque.
// · GAJOS SEPARADOS (paddingAngle + borde del color de la tarjeta): la separación es una
//   codificación además del color — con daltonismo o impreso en gris, los gajos siguen siendo
//   gajos distintos.
// · LA LEYENDA ES UNA LISTA CON MONTOS, no rótulos sueltos: con 3–5 categorías cabe completa, y
//   así el color nunca es la ÚNICA forma de saber cuál es cuál. El texto va en tinta normal — el
//   color vive en el punto de al lado, no en la letra.
// · El color de cada tipo es FIJO (var(--chart-N), asignado en ventas-por-tipo.ts): «Servicios»
//   es menta este mes y el que viene, venda lo que venda. Los cinco pasaron el validador de
//   paletas (banda de luminosidad, croma, separación con daltonismo, contraste) en claro y oscuro.

export function VentasDelMes({ datos }: { datos: VentaPorTipo[] }) {
  const total = datos.reduce((s, d) => s + d.totalCents, 0)

  return (
    <div className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-4">
      <div className="mb-3">
        <div className="flex items-center gap-1.5 font-display text-[17px] font-semibold leading-tight tracking-[-0.01em] text-fg">
          {/* Mismo tono que las pastillas de plata: la identidad del dominio, panel a panel. */}
          <Banknote aria-hidden className="size-4" style={{ color: "var(--chart-4)" }} />
          Ventas del mes por tipo
        </div>
        <div className="text-xs text-muted-foreground">
          Facturas emitidas este mes, partidas por lo que se vendió.
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <p className="text-sm text-muted-foreground">Todavía no hay ventas emitidas este mes.</p>
          <Link href="/dashboard/facturacion" className="text-xs text-primary hover:underline">
            Ir a Ventas
          </Link>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-4 sm:flex-row">
          <div className="relative h-[170px] w-[170px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value, name) => [formatCOP(Number(value)), String(name)]}
                />
                <Pie
                  data={datos.map((d) => ({ name: d.etiqueta, value: d.totalCents }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="var(--panel)"
                  strokeWidth={2}
                >
                  {datos.map((d) => (
                    <Cell key={d.tipo} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* El total, en el hueco. aria-hidden: el mismo número está en la leyenda accesible. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
            >
              <span className="text-[11px] text-muted-foreground">Total</span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {formatCOP(total)}
              </span>
            </div>
          </div>

          {/* LA BARRA DE PROPORCIÓN EN CADA FILA, como «Totales por servicio» de OkVet (David,
              26-ago). No repite lo que dice la dona: sirve justo para lo que la dona hace mal —
              comparar dos gajos parecidos, que en un anillo hay que medir con el ojo. La barra los
              apoya en una misma línea de base y la diferencia se ve sin pensar. */}
          <ul className="min-w-0 flex-1 space-y-2 text-sm">
            {datos.map((d) => {
              const pct = Math.round((d.totalCents / total) * 100)
              return (
                <li key={d.tipo}>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: d.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {d.etiqueta}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      {formatCOP(d.totalCents)}
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                  {/* `aria-hidden`: el monto y el porcentaje de arriba ya lo dicen: para un lector
                      de pantalla esto sería la misma información una tercera vez. */}
                  <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-card">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: d.color }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

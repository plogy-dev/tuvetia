"use client"

import Link from "next/link"
import { PawPrint } from "lucide-react"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"

import type { EspeciePaciente } from "@/lib/tablero/pacientes-por-especie"

// La dona de pacientes por especie — la segunda que pidió David (26-ago: «vuelve al de OkVet,
// quiero ver pie charts, más dinámico»). OkVet tiene dos ahí; ésta es la nuestra, con el dato que
// una veterinaria sí tiene: de qué son los pacientes.
//
// Hereda las decisiones de forma de `ventas-del-mes.tsx`, y no por copiar: dos donas contiguas que
// se comportan distinto se leen como dos widgets ajenos pegados. Dona (no torta) con el total en el
// hueco, gajos separados por el color de la tarjeta, y la leyenda con su número — el color nunca es
// la única forma de saber cuál es cuál.
//
// LO QUE SUMA SOBRE LA DE VENTAS: la BARRA de proporción en cada fila de la leyenda. Es lo que hace
// OkVet en «Totales por servicio», y sirve para lo que la dona hace mal — comparar dos gajos
// parecidos. La barra los pone sobre una misma línea de base y la diferencia se ve de una.

export function PacientesPorEspecie({ datos }: { datos: EspeciePaciente[] }) {
  const total = datos.reduce((s, d) => s + d.total, 0)

  return (
    <div className="flex h-full flex-col rounded-xl border border-line-soft bg-panel p-4">
      <div className="mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {/* El violeta de «pacientes», el mismo de su pastilla — identidad por dominio. */}
          <PawPrint aria-hidden className="size-4" style={{ color: "var(--chart-3)" }} />
          Pacientes por especie
        </div>
        <div className="text-xs text-muted-foreground">
          Las fichas activas de la clínica, por lo que son.
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <p className="text-sm text-muted-foreground">Todavía no hay pacientes con ficha.</p>
          <Link href="/dashboard/patients" className="text-xs text-primary hover:underline">
            Ir a Pacientes
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
                  formatter={(value, name) => [
                    `${value} ${Number(value) === 1 ? "paciente" : "pacientes"}`,
                    String(name),
                  ]}
                />
                <Pie
                  data={datos.map((d) => ({ name: d.etiqueta, value: d.total }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="var(--panel)"
                  strokeWidth={2}
                >
                  {datos.map((d) => (
                    <Cell key={d.especie} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* El total, en el hueco. aria-hidden: el mismo número está en la leyenda accesible. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
            >
              <span className="font-mono text-xl font-semibold tabular-nums">{total}</span>
              <span className="text-[11px] text-muted-foreground">
                {total === 1 ? "paciente" : "pacientes"}
              </span>
            </div>
          </div>

          <ul className="min-w-0 flex-1 space-y-2 text-sm">
            {datos.map((d) => {
              const pct = Math.round((d.total / total) * 100)
              return (
                <li key={d.especie}>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: d.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {d.etiqueta}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums">{d.total}</span>
                    <span className="w-9 shrink-0 text-right text-xs text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                  {/* La barra de proporción, como la referencia. `aria-hidden` porque el número y
                      el porcentaje de arriba ya lo dicen: para un lector de pantalla esto sería la
                      misma información una tercera vez. */}
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

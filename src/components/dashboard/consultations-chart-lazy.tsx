"use client"

// recharts (~100 KB) no es crítico para el primer paint del home: se difiere con next/dynamic.
import dynamic from "next/dynamic"

export const ConsultationsChartLazy = dynamic(
  () => import("./consultations-chart").then((m) => m.ConsultationsChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 animate-pulse rounded-xl border bg-card" aria-label="Cargando gráfico…" />
    ),
  },
)

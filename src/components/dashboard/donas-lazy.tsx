"use client"

// Mismo criterio que `consultations-chart-lazy.tsx`: recharts (~100 KB min + d3) no es crítico
// para el primer paint del home. Estas tres entraban ESTÁTICAS a la ruta de entrada y anulaban el
// lazy del gráfico de consultas — el chunk compartido de recharts lo cargaban ellas igual, aunque
// la facturación estuviera inactiva y las donas ni se pintaran (auditoría 28-ago).
import dynamic from "next/dynamic"

const cargando = () => (
  <div
    className="h-64 animate-pulse rounded-xl border border-line-soft bg-panel"
    aria-label="Cargando gráfico…"
  />
)

export const VentasDelMesLazy = dynamic(
  () => import("./ventas-del-mes").then((m) => m.VentasDelMes),
  { ssr: false, loading: cargando },
)

export const PacientesPorEspecieLazy = dynamic(
  () => import("./pacientes-por-especie").then((m) => m.PacientesPorEspecie),
  { ssr: false, loading: cargando },
)

export const CumplimientoDeVentasLazy = dynamic(
  () => import("./cumplimiento-de-ventas").then((m) => m.CumplimientoDeVentas),
  { ssr: false, loading: cargando },
)

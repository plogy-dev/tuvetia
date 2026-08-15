import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { HelpTip } from "@/components/help-tip"

export type Metric = {
  label: string
  value: number
  hint: string
  icon?: React.ReactNode
  help?: string
}

// Tarjetas de resumen de la clínica (datos reales, por RLS). Presentacional: la página server
// hace las cuentas y las pasa por props.
export function SectionCards({ metrics }: { metrics: Metric[] }) {
  return (
    // SIN DEGRADADO Y SIN SOMBRA. El `bg-linear-to-t from-primary/5` y el `shadow-xs` venían de la
    // plantilla `dashboard-01` de shadcn y sobrevivieron al cambio de sistema de diseño: sobre el
    // brasa apenas se notaban, sobre blanco puro son una mancha verdosa en cada tarjeta. El sistema
    // del cliente es explícitamente plano y su StatCard va sin sombra.
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {metrics.map((m) => (
        <Card key={m.label} className="@container/card">
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              {m.icon}
              {m.label}
              {m.help && <HelpTip>{m.help}</HelpTip>}
            </CardDescription>
            {/* La cifra en MONO, como el mockup: es lo que hace que una columna de números se
                alinee sola y se lea como un dato y no como un titular. */}
            <CardTitle className="font-mono text-[28px] font-medium tabular-nums">
              {m.value}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{m.hint}</p>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

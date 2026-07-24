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
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {metrics.map((m) => (
        <Card key={m.label} className="@container/card">
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              {m.icon}
              {m.label}
              {m.help && <HelpTip>{m.help}</HelpTip>}
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {m.value}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{m.hint}</p>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

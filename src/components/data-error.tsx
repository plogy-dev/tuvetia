import { AlertTriangle } from "lucide-react"

// Estado de ERROR de carga, distinto del estado vacío: sin esto, un fallo de query (RLS, red,
// columna renombrada) se ve idéntico a "todavía no hay datos" y nadie se entera.
export function DataError({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div>
        <p className="font-medium text-destructive">No se pudieron cargar los datos.</p>
        <p className="text-muted-foreground">
          {children ?? "Recargá la página para reintentar. Si persiste, avisá al equipo."}
        </p>
      </div>
    </div>
  )
}

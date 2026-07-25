// Skeleton con la forma real de la ficha del paciente (cabecera + maestro-detalle de consultas).
export default function PatientHistoryLoading() {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:py-6 lg:px-6" aria-busy="true">
      <div className="flex items-center gap-4">
        <div className="size-14 animate-pulse rounded-full bg-muted" />
        <div className="flex flex-col gap-2">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_1fr]">
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
        <div className="h-[50vh] animate-pulse rounded-xl border bg-muted/30" />
      </div>
      <span className="sr-only">Cargando historia del paciente…</span>
    </div>
  )
}

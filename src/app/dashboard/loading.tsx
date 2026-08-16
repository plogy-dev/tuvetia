// Skeleton de carga del dashboard: Next lo muestra al instante durante la navegación a cualquier
// ruta hija (que no tenga su propio loading.tsx), mientras el server component resuelve sus queries.
// El shell (sidebar + header del layout) queda visible; solo el área de contenido pulsa.

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6" aria-busy="true">
      <div className="flex items-center justify-between gap-2">
        <div className="h-6 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b p-3 last:border-0">
            <div className="size-9 shrink-0 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 flex-1 animate-pulse rounded-md bg-muted" />
            <div className="hidden h-4 w-24 animate-pulse rounded-md bg-muted sm:block" />
            <div className="h-4 w-16 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  )
}

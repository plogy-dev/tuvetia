// Skeleton con la forma real del calendario (toolbar + grilla) para que la navegación pinte al instante.
export default function CalendarioLoading() {
  return (
    <div className="px-4 py-4 md:py-6 lg:px-6" aria-busy="true">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="h-[70vh] animate-pulse rounded-xl border bg-muted/40" />
      <span className="sr-only">Cargando calendario…</span>
    </div>
  )
}

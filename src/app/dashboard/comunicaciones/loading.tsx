// Skeleton con la forma real de la bandeja (conversaciones + hilo) mientras cargan los mensajes.
export default function ComunicacionesLoading() {
  return (
    <div
      className="grid h-[calc(100svh-var(--header-height)-2rem)] gap-4 px-4 py-4 lg:grid-cols-[minmax(230px,300px)_1fr] lg:px-6"
      aria-busy="true"
    >
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
      <div className="animate-pulse rounded-xl border bg-muted/30" />
      <span className="sr-only">Cargando conversaciones…</span>
    </div>
  )
}

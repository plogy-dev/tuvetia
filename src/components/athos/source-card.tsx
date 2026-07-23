import { ExternalLink } from "lucide-react"

import type { Citation } from "@/lib/athos"

// Tarjeta de fuente verificable enlazada al artículo. url/title/year vienen del corpus (Athos).
// Compartida entre el copiloto (chat) y la nota del Phantom para que citen igual.
export function SourceCard({ c }: { c: Citation }) {
  const meta = (
    <>
      <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Fuente verificable
        {c.url && <ExternalLink className="size-3" />}
      </div>
      {c.title && <div className="text-sm leading-snug font-medium">{c.title}</div>}
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        {c.source && <span className="font-medium text-foreground/80">{c.source}</span>}
        {c.year && <span className="font-mono">{c.year}</span>}
        {c.locator && <span>· {c.locator}</span>}
        {c.doc_id && <span className="opacity-70">{c.doc_id}</span>}
      </div>
    </>
  )
  return c.url ? (
    <a
      href={c.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border bg-muted/40 p-3 transition-colors hover:border-foreground/20 hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {meta}
    </a>
  ) : (
    <div className="rounded-lg border bg-muted/40 p-3">{meta}</div>
  )
}

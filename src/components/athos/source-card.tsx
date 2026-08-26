import { ExternalLink } from "lucide-react"

import type { Citation } from "@/lib/athos"

// Tarjeta de fuente verificable enlazada al artículo. url/title/year vienen del corpus (VetGPT).
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
        {/* La REVISTA, no la base de datos: "Journal of feline medicine and surgery", no "PubMed"
            (reunión 24-ago: el artículo es de su revista, no de la biblioteca donde está). El
            `source` viejo queda solo como último recurso para citas persistidas sin journal y sin
            título — una tarjeta sin ningún origen es peor. */}
        {c.journal ? (
          <span className="font-medium text-foreground">{c.journal}</span>
        ) : !c.title && c.source ? (
          <span className="font-medium text-foreground">{c.source}</span>
        ) : null}
        {c.year && <span className="font-mono">{c.year}</span>}
        {c.locator && <span>· {c.locator}</span>}
        {c.doc_id && <span>{c.doc_id}</span>}
      </div>
    </>
  )
  return c.url ? (
    <a
      href={c.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border bg-muted p-3 transition-colors hover:border-input hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {meta}
    </a>
  ) : (
    <div className="rounded-xl border bg-muted p-3">{meta}</div>
  )
}

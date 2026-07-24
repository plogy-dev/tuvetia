import type { ReactNode } from "react"

import type { Citation } from "@/lib/athos"

// Resalta el lenguaje de posibilidad (regla clínica: nunca diagnóstico cerrado).
export const POSSIBILITY =
  /(compatible con|sugestivo de|sugerente de|no hay evidencia suficiente|evidencia insuficiente|posiblemente|posible|podría|sugiere|se recomienda valorar)/i

// Renderiza texto inline: negritas **..**, marcadores de cita [n] enlazados a su fuente, y resalta
// el lenguaje de posibilidad. Compartido por el Copiloto, el hilo embebido y la nota del Phantom.
export function renderInline(text: string, citations: Citation[], kp: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pushText = (t: string, base: string) => {
    t.split(new RegExp(POSSIBILITY.source, "gi")).forEach((p, j) => {
      if (!p) return
      nodes.push(
        POSSIBILITY.test(p) ? (
          <span
            key={`${base}-p${j}`}
            className="font-medium text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-2"
          >
            {p}
          </span>
        ) : (
          <span key={`${base}-t${j}`}>{p}</span>
        ),
      )
    })
  }
  const regex = /(\[\d+\])|(\*\*[^*]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) pushText(text.slice(last, m.index), `${kp}-x${k}`)
    if (m[1]) {
      const n = parseInt(m[1].slice(1, -1), 10)
      const c = citations[n - 1]
      const cls =
        "mx-0.5 inline-block rounded border bg-secondary px-1 font-mono text-[11px] font-bold text-foreground underline decoration-dotted underline-offset-2 align-baseline"
      nodes.push(
        c?.url ? (
          <a
            key={`${kp}-c${k}`}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            title={c.title ?? c.source ?? "Ver fuente"}
            className={`${cls} hover:bg-accent`}
          >
            [{n}]
          </a>
        ) : (
          <span key={`${kp}-c${k}`} className={cls}>
            [{n}]
          </span>
        ),
      )
    } else if (m[2]) {
      nodes.push(
        <strong key={`${kp}-b${k}`} className="font-semibold text-foreground">
          {m[2].slice(2, -2)}
        </strong>,
      )
    }
    last = regex.lastIndex
    k++
  }
  if (last < text.length) pushText(text.slice(last), `${kp}-x${k}`)
  return nodes
}

// Divide una respuesta en bloques (encabezados, viñetas, párrafos) para un formato limpio.
export function splitBlocks(content: string): { text: string; bullet: boolean; heading: boolean }[] {
  return content
    .split(/\n{2,}|\n(?=\s*(?:[-•*]|\d+\.)\s)/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const heading = /^#{1,6}\s/.test(b)
      const bullet = !heading && /^\s*(?:[-•*]|\d+\.)\s+/.test(b)
      let text = b
      if (heading) text = b.replace(/^#{1,6}\s+/, "")
      else if (bullet) text = b.replace(/^\s*(?:[-•*]|\d+\.)\s+/, "")
      return { text, bullet, heading }
    })
}

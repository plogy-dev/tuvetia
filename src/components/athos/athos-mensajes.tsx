"use client"

// El hilo de mensajes de Athos: burbujas, bloques de texto y tarjetas de propuesta.
//
// Salió TAL CUAL de `onboarding/onboarding-athos.tsx` cuando apareció el widget global y hubo tres
// copias del mismo render. Se extrajo de ahí y no de `asistente/assistant.tsx` a propósito: el
// onboarding es la copia más chica y de menor tráfico, así que mover ese código es demostrablemente
// un movimiento y no una refactorización de una pantalla en uso clínico diario.
//
// `assistant.tsx` sigue con la suya. Quedan dos copias en vez de tres, y la que se toca de acá en
// adelante es ésta.

import { getToolName as getStaticToolName, type ToolUIPart, type UIMessage } from "ai"
import { Loader2 } from "lucide-react"

import { ActionApprovalCard } from "@/components/athos/action-approval-card"
import { renderInline, splitBlocks } from "@/components/athos/rich-text"

/** Una tool de ESCRITURA no ejecuta: devuelve la acción ya registrada como propuesta. */
export function comoPropuesta(output: unknown): { action_id: string; summary: string } | null {
  if (!output || typeof output !== "object") return null
  const o = output as Record<string, unknown>
  return typeof o.action_id === "string" && o.status === "proposed" && typeof o.summary === "string"
    ? { action_id: o.action_id, summary: o.summary }
    : null
}

export function AthosMensajes({ messages }: { messages: UIMessage[] }) {
  return (
    <>
      {messages.map((m) => (
        <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
          {m.role === "user" ? (
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
              {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {m.parts.map((p, i) => {
                if (p.type === "text") {
                  return (
                    <div
                      key={i}
                      className="rounded-2xl rounded-tl-sm border bg-muted px-3 py-1 text-sm leading-relaxed"
                    >
                      {splitBlocks(p.text).map((blk, j) => (
                        <div key={j} className="border-b border-border py-2 last:border-b-0 last:pb-0">
                          {renderInline(blk.text, [], `${m.id}-${i}-${j}`)}
                        </div>
                      ))}
                    </div>
                  )
                }
                if (p.type.startsWith("tool-")) {
                  const part = p as ToolUIPart
                  if (part.state === "output-available") {
                    const prop = comoPropuesta(part.output)
                    if (prop) {
                      return (
                        <ActionApprovalCard
                          key={i}
                          action={{
                            id: prop.action_id,
                            tool_name: String(getStaticToolName(part)),
                            summary: prop.summary,
                            payload: (part.input ?? {}) as Record<string, unknown>,
                            status: "proposed",
                          }}
                        />
                      )
                    }
                    return null
                  }
                  return (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> Consultando…
                    </div>
                  )
                }
                return null
              })}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

"use client"

// Hilo de la consulta (mockup-nota-athos, columna derecha): el copiloto embebido en la pantalla
// del Phantom. Mismo backend que /dashboard/asistente (memoria por paciente en Athos), en formato
// compacto y sticky junto a la nota.

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Bot, Loader2, Send } from "lucide-react"
import { toast } from "sonner"

import { athosChat, type Citation } from "@/lib/athos"
import { renderInline, splitBlocks } from "@/components/athos/rich-text"
import { Button } from "@/components/ui/button"

type Msg = {
  role: "user" | "assistant"
  content: string
  warning?: string
  citations?: Citation[]
  streaming?: boolean
}

export function ConsultationThread({
  clinicId,
  patientId,
  patientName,
}: {
  clinicId: string
  patientId: string
  patientName?: string
}) {
  const [question, setQuestion] = useState("")
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const msgsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight })
  }, [messages])

  const patchLast = (fn: (m: Msg) => Msg) =>
    setMessages((prev) => {
      if (prev.length === 0) return prev
      const next = [...prev]
      next[next.length - 1] = fn(next[next.length - 1])
      return next
    })

  async function ask() {
    const q = question.trim()
    if (!q || loading) return
    setLoading(true)
    setQuestion("")
    setMessages((prev) => [
      ...prev,
      { role: "user", content: q },
      { role: "assistant", content: "", streaming: true },
    ])
    await athosChat(
      { question: q, patientId, clinicId },
      {
        onWarning: (t) => patchLast((m) => ({ ...m, warning: t })),
        onToken: (t) => patchLast((m) => ({ ...m, content: m.content + t })),
        onDone: (d) => {
          patchLast((m) => ({ ...m, citations: d.citations, streaming: false }))
          setLoading(false)
        },
        onError: (e) => {
          patchLast((m) => ({
            ...m,
            content: m.content || "No se pudo consultar a Athos.",
            streaming: false,
          }))
          toast.error(`No se pudo consultar a Athos: ${(e as Error)?.message ?? e}`)
          setLoading(false)
        },
      },
    )
  }

  return (
    <section className="flex max-h-[calc(100vh-7rem)] flex-col rounded-xl border bg-card shadow-sm lg:sticky lg:top-20">
      <div className="border-b px-4 pt-4 pb-3">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
          Hilo de la consulta
        </p>
        <div className="flex items-center gap-2 rounded-lg border bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground" />
          <span>
            Recuerda el contexto de{" "}
            <b className="font-semibold text-foreground">{patientName ?? "este paciente"}</b>
          </span>
        </div>
      </div>

      <div ref={msgsRef} className="flex min-h-40 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="m-auto max-w-[26ch] text-center text-xs text-muted-foreground">
            Pregúntale a Athos sobre este caso — responde con literatura citada, nunca un
            diagnóstico cerrado.
          </p>
        )}
        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div key={i} className="flex flex-col items-end gap-1">
              <span className="px-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Veterinario
              </span>
              <div className="max-w-[92%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col items-start gap-1">
              <span className="px-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Athos
              </span>
              {msg.warning && (
                <div className="mb-1 flex w-full items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{msg.warning}</span>
                </div>
              )}
              <div className="max-w-[95%] rounded-2xl rounded-bl-sm border bg-secondary px-3 py-2 text-sm leading-relaxed">
                {splitBlocks(msg.content).map((blk, j) => (
                  <div key={j} className={j > 0 ? "mt-2" : undefined}>
                    {blk.bullet && (
                      <span className="mr-1.5 inline-block size-1.5 rounded-full bg-muted-foreground align-middle" />
                    )}
                    {renderInline(blk.text, msg.citations ?? [], `t${i}-${j}`)}
                  </div>
                ))}
                {msg.streaming && (
                  <span className="inline-block h-3.5 w-1 animate-pulse bg-foreground align-middle" />
                )}
              </div>
            </div>
          ),
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault()
          ask()
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`Pregunta sobre ${patientName ?? "el caso"}…`}
          aria-label="Pregunta para Athos"
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Button size="icon" type="submit" disabled={loading} aria-label="Enviar">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>
      <p className="sr-only">
        <Bot className="size-3" /> Copiloto embebido de la consulta
      </p>
    </section>
  )
}

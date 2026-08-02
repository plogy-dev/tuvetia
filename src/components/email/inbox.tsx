"use client"

// Bandeja de correo de la clínica. Misma forma que la de WhatsApp (maestro-detalle + Realtime):
// hilos a la izquierda, conversación y compositor a la derecha.
//
// Diferencias propias del correo, no cosméticas:
//   - Se agrupa por HILO (email_threads), no por contacto: la misma persona puede tener varias
//     conversaciones abiertas y mezclarlas haría ilegible cada una.
//   - Responder no lleva destinatario ni asunto: los resuelve el servidor desde el hilo, que es lo
//     que garantiza que la respuesta llegue a quien escribió y quede EN el hilo (RFC 5322).
//   - No hay envío "nuevo" desde acá todavía: para eso está Athos, que redacta y propone.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Mail, RefreshCw, Send, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { normalizarFilaRealtime } from "@/lib/realtime-timestamp"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/empty-state"
import { ActionApprovalCard, type ProposedAction } from "@/components/athos/action-approval-card"

export type InboxThread = {
  id: string
  subject: string | null
  participants: string[] | null
  owner_id: string | null
  last_message_at: string
  unread_count: number
  owner: { full_name: string } | null
}

export type InboxEmail = {
  id: string
  thread_id: string
  direction: "inbound" | "outbound"
  from_email: string
  subject: string | null
  body_text: string | null
  snippet: string | null
  created_at: string
  attachments: { filename: string; bytes: number }[] | null
}

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  const hoy = new Date()
  const mismoDia =
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate()
  return mismoDia
    ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" })
}

export function EmailInbox({
  initialThreads,
  initialMessages,
}: {
  initialThreads: InboxThread[]
  initialMessages: InboxEmail[]
}) {
  const [supabase] = useState(() => createClient())
  const [threads, setThreads] = useState(initialThreads)
  const [messages, setMessages] = useState(initialMessages)
  const [selectedId, setSelectedId] = useState<string | null>(initialThreads[0]?.id ?? null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [acciones, setAcciones] = useState<ProposedAction[]>([])

  // Cursor monótono para la puesta al día tras una caída del socket — mismo patrón que la bandeja
  // de WhatsApp, donde se documentó por qué no alcanza con solo escuchar INSERTs.
  const cursorRef = useRef<string>(
    initialMessages[initialMessages.length - 1]?.created_at ?? new Date(0).toISOString(),
  )

  const thread = useMemo(() => threads.find((t) => t.id === selectedId) ?? null, [threads, selectedId])
  const hilo = useMemo(
    () =>
      messages
        .filter((m) => m.thread_id === selectedId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages, selectedId],
  )

  const agregar = useCallback((nuevos: InboxEmail[]) => {
    if (nuevos.length === 0) return
    setMessages((prev) => {
      const vistos = new Set(prev.map((m) => m.id))
      const faltantes = nuevos.filter((m) => !vistos.has(m.id))
      if (faltantes.length === 0) return prev
      for (const m of faltantes) {
        if (m.created_at > cursorRef.current) cursorRef.current = m.created_at
      }
      return [...prev, ...faltantes]
    })
  }, [])

  useEffect(() => {
    const canal = supabase
      .channel("email-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "email_messages" },
        // `normalizarFilaRealtime` NO es opcional: Realtime entrega los `timestamptz` con el formato
        // del WAL ("2026-08-01 19:19:20+00") y PostgREST con el ISO de JSON ("…T19:19:20+00:00"). Y
        // como `' '` (0x20) es menor que `'T'` (0x54), un correo recién llegado se ordenaba ARRIBA de
        // todo el hilo en el `localeCompare` de acá abajo, y el cursor no avanzaba nunca con las
        // filas del socket. Mismo defecto que tuvo la bandeja de WhatsApp.
        (payload) =>
          agregar([
            normalizarFilaRealtime(payload.new as unknown as InboxEmail, ["created_at"]),
          ]),
      )
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return
        // Puesta al día: lo que entró mientras el socket estuvo caído no llega como evento.
        const { data } = await supabase
          .from("email_messages")
          .select("id, thread_id, direction, from_email, subject, body_text, snippet, created_at, attachments")
          .gt("created_at", cursorRef.current)
          .order("created_at", { ascending: true })
        agregar((data ?? []) as unknown as InboxEmail[])
      })
    return () => {
      void supabase.removeChannel(canal)
    }
  }, [supabase, agregar])

  // Al abrir un hilo: marcar leído y traer lo que Athos haya propuesto para él.
  useEffect(() => {
    if (!selectedId) return
    let cancelado = false
    void (async () => {
      await supabase.rpc("mark_email_thread_read", { p_thread_id: selectedId })
      if (cancelado) return
      setThreads((prev) => prev.map((t) => (t.id === selectedId ? { ...t, unread_count: 0 } : t)))
      const { data } = await supabase
        .from("athos_actions")
        .select("id, tool_name, summary, payload, status, created_at")
        .eq("conversation_key", selectedId)
        .eq("status", "proposed")
        .order("created_at", { ascending: false })
      if (!cancelado) setAcciones((data ?? []) as unknown as ProposedAction[])
    })()
    return () => {
      cancelado = true
    }
  }, [supabase, selectedId])

  async function responder() {
    if (!selectedId || !draft.trim()) return
    setSending(true)
    try {
      const res = await fetch("/api/email/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: selectedId, body: draft.trim() }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; aviso?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setDraft("")
      if (json.aviso) toast.warning(json.aviso)
      else toast.success("Respuesta enviada")
      // El mensaje aparece por Realtime; no se inserta a mano para no duplicarlo.
    } catch (e) {
      toast.error(`No se pudo enviar: ${(e as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  if (threads.length === 0) {
    return (
      <div className="px-4 py-10 lg:px-6">
        <EmptyState
          title="Todavía no hay correos"
          description="El buzón se lee cada pocos minutos. Cuando llegue un correo a la cuenta de la clínica, va a aparecer acá."
        />
      </div>
    )
  }

  return (
    <div className="grid h-[calc(100svh-var(--header-height)-2rem)] gap-4 px-4 py-4 lg:grid-cols-[minmax(240px,320px)_1fr] lg:px-6">
      {/* Maestro: hilos */}
      <div className="flex flex-col gap-1 overflow-y-auto rounded-xl border bg-card p-1.5">
        {threads.map((t) => {
          const sel = t.id === selectedId
          const quien = t.owner?.full_name ?? (t.participants ?? [])[0] ?? "(desconocido)"
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={`flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${
                sel ? "bg-primary/10" : "hover:bg-muted"
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{quien}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {fmtFecha(t.last_message_at)}
                </span>
              </span>
              <span className="line-clamp-1 w-full text-xs text-muted-foreground">
                {t.subject || "(sin asunto)"}
              </span>
              {t.unread_count > 0 && (
                <span className="mt-0.5 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {t.unread_count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Detalle: la conversación */}
      <div className="flex min-h-0 flex-col rounded-xl border bg-card">
        {thread ? (
          <>
            <div className="border-b px-4 py-3">
              <div className="text-sm font-semibold">{thread.subject || "(sin asunto)"}</div>
              <div className="text-xs text-muted-foreground">
                {thread.owner?.full_name ?? (thread.participants ?? []).join(", ")}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              {hilo.map((m) => (
                <div
                  key={m.id}
                  className={m.direction === "outbound" ? "flex flex-col items-end" : "flex flex-col items-start"}
                >
                  <span className="mb-0.5 px-1 text-[10px] text-muted-foreground">
                    {m.from_email} · {fmtFecha(m.created_at)}
                  </span>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      m.direction === "outbound"
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm border bg-background"
                    }`}
                  >
                    {m.body_text || m.snippet || "(sin contenido)"}
                  </div>
                  {(m.attachments ?? []).length > 0 && (
                    <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                      📎 {(m.attachments ?? []).map((a) => a.filename).join(", ")}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {acciones.length > 0 && (
              <div className="flex flex-col gap-2 border-t px-4 py-3">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="size-3.5 text-brand" /> Athos propone
                </span>
                {acciones.map((a) => (
                  <ActionApprovalCard
                    key={a.id}
                    action={a}
                    onResolved={(id) => setAcciones((prev) => prev.filter((x) => x.id !== id))}
                  />
                ))}
              </div>
            )}

            <div className="flex items-end gap-2 border-t p-3">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escribí tu respuesta…"
                className="min-h-16 flex-1 text-sm"
                aria-label="Respuesta"
              />
              <Button onClick={responder} disabled={sending || !draft.trim()}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Responder
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-8" />
              Elegí un hilo para leerlo.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Botón para forzar un barrido sin esperar al cron. Vive en la cabecera de la pestaña. */
export function EmailRefreshButton() {
  const [busy, setBusy] = useState(false)
  async function refrescar() {
    setBusy(true)
    try {
      const res = await fetch("/api/email/sync", { method: "POST" })
      const json = (await res.json().catch(() => ({}))) as { stored?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast.success(`Buzón actualizado (${json.stored ?? 0} nuevos)`)
      // Los mensajes nuevos llegan por Realtime; los hilos se ven al recargar.
      window.location.reload()
    } catch (e) {
      toast.error(`No se pudo actualizar: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={refrescar} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      Actualizar
    </Button>
  )
}

"use client"

// Bandeja de WhatsApp — master-detail: conversaciones a la izquierda (agrupadas por teléfono del
// contacto), hilo a la derecha con composer. Entrantes via webhook (poll cada 15 s por RLS);
// salientes via /api/whatsapp/send (ticks de entregado/leído los actualiza el webhook).
// Al abrir una conversación se marcan leídos los entrantes (policy UPDATE, migración 0018).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, CheckCheck, Loader2, MessageCircle, Plus, Send } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type InboxMessage = {
  id: string
  owner_id: string | null
  wa_message_id: string | null
  wa_phone_from: string
  wa_phone_to: string
  direction: "inbound" | "outbound"
  body: string | null
  media_type: string | null
  read_at: string | null
  delivered_at: string | null
  created_at: string
}
export type InboxOwner = { id: string; full_name: string; phone: string | null }

const digits = (s: string) => s.replace(/\D/g, "")

function contactOf(m: InboxMessage): string {
  return digits(m.direction === "inbound" ? m.wa_phone_from : m.wa_phone_to)
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" })
}

export function WhatsappInbox({
  initialMessages,
  owners,
  clinicPhone,
}: {
  initialMessages: InboxMessage[]
  owners: InboxOwner[]
  clinicPhone: string
}) {
  const [supabase] = useState(() => createClient())
  const [messages, setMessages] = useState<InboxMessage[]>(initialMessages)
  const [selected, setSelected] = useState<string | null>(null) // teléfono (dígitos) del contacto
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)

  // Nombre del contacto: por owner_id del mensaje o match de teléfono con titulares.
  const ownerByPhone = useMemo(() => {
    const map = new Map<string, InboxOwner>()
    for (const o of owners) if (o.phone) map.set(digits(o.phone).slice(-10), o)
    return map
  }, [owners])
  const nameOf = useCallback(
    (phone: string) => ownerByPhone.get(phone.slice(-10))?.full_name ?? `+${phone}`,
    [ownerByPhone],
  )

  // Conversaciones: última primero, con no-leídos.
  const conversations = useMemo(() => {
    const by = new Map<string, { phone: string; last: InboxMessage; unread: number }>()
    for (const m of messages) {
      const key = contactOf(m)
      if (!key) continue
      const cur = by.get(key)
      const unread = m.direction === "inbound" && !m.read_at ? 1 : 0
      if (!cur) by.set(key, { phone: key, last: m, unread })
      else {
        if (m.created_at > cur.last.created_at) cur.last = m
        cur.unread += unread
      }
    }
    return [...by.values()].sort((a, b) => (a.last.created_at < b.last.created_at ? 1 : -1))
  }, [messages])

  const thread = useMemo(
    () => (selected ? messages.filter((m) => contactOf(m) === selected) : []),
    [messages, selected],
  )

  // Poll de mensajes nuevos cada 15 s (RLS: solo la clínica).
  useEffect(() => {
    const t = setInterval(() => {
      void (async () => {
        const latest = messages.at(-1)?.created_at ?? new Date(0).toISOString()
        const { data } = await supabase
          .from("whatsapp_messages")
          .select("id, owner_id, wa_message_id, wa_phone_from, wa_phone_to, direction, body, media_type, read_at, delivered_at, created_at")
          .gt("created_at", latest)
          .order("created_at", { ascending: true })
        const fresh = (data as InboxMessage[] | null) ?? []
        if (fresh.length) setMessages((prev) => [...prev, ...fresh.filter((f) => !prev.some((p) => p.id === f.id))])
      })()
    }, 15000)
    return () => clearInterval(t)
  }, [supabase, messages])

  // Al abrir una conversación: marcar leídos los entrantes.
  const openConversation = useCallback(
    (phone: string) => {
      setSelected(phone)
      setShowNew(false)
      const unreadIds = messages
        .filter((m) => contactOf(m) === phone && m.direction === "inbound" && !m.read_at)
        .map((m) => m.id)
      if (unreadIds.length) {
        const now = new Date().toISOString()
        setMessages((prev) => prev.map((m) => (unreadIds.includes(m.id) ? { ...m, read_at: now } : m)))
        void supabase.from("whatsapp_messages").update({ read_at: now }).in("id", unreadIds)
      }
    },
    [messages, supabase],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "instant", block: "end" })
  }, [thread.length, selected])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || !draft.trim()) return
    setSending(true)
    try {
      const owner = ownerByPhone.get(selected.slice(-10))
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selected, body: draft.trim(), owner_id: owner?.id ?? null }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      // Optimista: el poll lo reemplaza con la fila real (dedupe por id).
      setMessages((prev) => [
        ...prev,
        {
          id: `tmp-${Date.now()}`,
          owner_id: owner?.id ?? null,
          wa_message_id: null,
          wa_phone_from: clinicPhone,
          wa_phone_to: selected,
          direction: "outbound",
          body: draft.trim(),
          media_type: null,
          read_at: null,
          delivered_at: null,
          created_at: new Date().toISOString(),
        },
      ])
      setDraft("")
    } catch (err) {
      toast.error(`No se pudo enviar: ${(err as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  const newCandidates = owners.filter((o) => o.phone && !conversations.some((c) => c.phone === digits(o.phone!)))

  return (
    <div className="grid h-[calc(100svh-var(--header-height)-2rem)] gap-4 px-4 py-4 lg:grid-cols-[minmax(230px,300px)_1fr] lg:px-6">
      {/* Conversaciones */}
      <div className="flex min-h-0 flex-col rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessageCircle className="size-4 text-muted-foreground" /> Conversaciones
          </div>
          <Button size="sm" variant="ghost" onClick={() => setShowNew((v) => !v)} aria-label="Nueva conversación">
            <Plus className="size-4" />
          </Button>
        </div>
        {showNew && (
          <div className="border-b p-2">
            <Select value={null} onValueChange={(v) => v && openConversation(digits(String(v)))}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escribir a un titular…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {newCandidates.length === 0 && (
                    <SelectItem value="__none__" disabled>
                      Sin titulares con teléfono
                    </SelectItem>
                  )}
                  {newCandidates.map((o) => (
                    <SelectItem key={o.id} value={o.phone!}>
                      {o.full_name} · {o.phone}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              Sin conversaciones aún. Cuando un titular escriba al WhatsApp de la clínica, aparecerá acá.
            </p>
          )}
          {conversations.map((c) => (
            <button
              key={c.phone}
              type="button"
              onClick={() => openConversation(c.phone)}
              className={`flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left transition-colors ${
                selected === c.phone ? "bg-primary/10" : "hover:bg-muted/50"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{nameOf(c.phone)}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(c.last.created_at)}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {c.last.direction === "outbound" ? "Tú: " : ""}
                  {c.last.body ?? `[${c.last.media_type ?? "adjunto"}]`}
                </span>
                {c.unread > 0 && (
                  <span className="grid size-4.5 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {c.unread}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Hilo */}
      <div className="flex min-h-0 flex-col rounded-xl border bg-card">
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <MessageCircle className="size-8" />
            Elegí una conversación o iniciá una nueva con “+”.
          </div>
        ) : (
          <>
            <div className="border-b px-4 py-2.5 text-sm font-semibold">{nameOf(selected)}</div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
              {thread.map((m) => (
                <div key={m.id} className={m.direction === "outbound" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      m.direction === "outbound"
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm border bg-background"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.body ?? `[${m.media_type ?? "adjunto"}]`}</p>
                    <span className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${m.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {fmtTime(m.created_at)}
                      {m.direction === "outbound" &&
                        (m.read_at ? (
                          <CheckCheck className="size-3 text-sky-300" />
                        ) : m.delivered_at ? (
                          <CheckCheck className="size-3" />
                        ) : (
                          <Check className="size-3" />
                        ))}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form onSubmit={send} className="flex items-center gap-2 border-t p-3">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escribe un mensaje…"
                autoFocus
              />
              <Button type="submit" disabled={sending || !draft.trim()} aria-label="Enviar">
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

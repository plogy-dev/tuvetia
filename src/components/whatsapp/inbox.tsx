"use client"

// Bandeja de WhatsApp — master-detail: conversaciones a la izquierda (agrupadas por teléfono del
// contacto), hilo a la derecha con composer. Entrantes via webhook, que aterrizan en la pantalla al
// instante por Realtime (con RLS por clínica); salientes via /api/whatsapp/send (los ticks de
// entregado/leído los escribe el webhook y llegan como UPDATE de la misma fila).
// Al abrir una conversación se marcan leídos los entrantes (policy UPDATE, migración 0018).

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, CheckCheck, CircleAlert, Loader2, MessageCircle, Plus, Send, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { normalizarFilaRealtime } from "@/lib/realtime-timestamp"
import { ActionApprovalCard, type ProposedAction } from "@/components/athos/action-approval-card"
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
  failed_at?: string | null
  error_detail?: string | null
  created_at: string
}
export type InboxOwner = { id: string; full_name: string; phone: string | null }

const digits = (s: string) => s.replace(/\D/g, "")

// Al enviar no se pinta un mensaje optimista: /api/whatsapp/send devuelve la fila REAL (id y
// created_at de la BD) y esa es la que se añade. Así el id que ya está en pantalla es el mismo que
// traerá el evento de Realtime, y deduplicar por id alcanza.

function contactOf(m: InboxMessage): string {
  return digits(m.direction === "inbound" ? m.wa_phone_from : m.wa_phone_to)
}

// Realtime entrega los `timestamptz` con el formato del WAL ("… 19:19:20+00") y PostgREST con el
// ISO de JSON ("…T19:19:20+00:00"). Este componente compara `created_at` como string —el cursor y
// el orden de las conversaciones— así que las filas que llegan por el socket se pasan por acá ANTES
// de tocar el estado. Ver `lib/realtime-timestamp.ts` para la medición que lo motivó.
const CAMPOS_FECHA = ["created_at", "read_at", "delivered_at", "failed_at"] as const

const desdeRealtime = (row: InboxMessage): InboxMessage =>
  normalizarFilaRealtime(row, CAMPOS_FECHA)

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
  const [suggesting, setSuggesting] = useState(false)
  const [showNew, setShowNew] = useState(false)
  // Sugerencia de Athos = acción 'proposed' persistida: enviar el borrador es APROBARLA.
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [proposals, setProposals] = useState<ProposedAction[]>([])
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

  // Cursor de la puesta al día: SOLO avanza con created_at que vienen de la BD. Nunca usar el reloj
  // del navegador — un reloj adelantado dejaba el .gt() ciego para siempre.
  const cursorRef = useRef<string>(initialMessages.at(-1)?.created_at ?? new Date(0).toISOString())

  // Añade filas nuevas sin duplicar y adelanta el cursor. Se usa desde los dos caminos: el evento
  // de Realtime y la puesta al día.
  const applyFresh = useCallback((fresh: InboxMessage[]) => {
    if (!fresh.length) return
    for (const f of fresh) if (f.created_at > cursorRef.current) cursorRef.current = f.created_at
    setMessages((prev) => [
      ...prev,
      ...fresh.filter(
        (f) =>
          !prev.some(
            (p) => p.id === f.id || (f.wa_message_id !== null && p.wa_message_id === f.wa_message_id),
          ),
      ),
    ])
  }, [])

  // Mensajes al instante por Realtime, en vez del poll de 15 s que había antes (y el de 20 s de los
  // ticks): un WhatsApp podía tardar un cuarto de minuto en aparecer en pantalla.
  //
  // La suscripción NO va sola. Realtime pierde eventos mientras el socket está caído —portátil
  // suspendido, cambio de red, redeploy— y esos mensajes no se reenvían nunca. Por eso en cada
  // SUBSCRIBED (el primero y el de cada reconexión) se hace una puesta al día con el mismo cursor
  // que usaba el poll: cierra justo el hueco que una suscripción a secas dejaría abierto.
  //
  // RLS se aplica del lado del servidor sobre cada evento (policy `whatsapp_messages_select`), así
  // que esto sólo recibe lo de la propia clínica. Requiere que la tabla esté en la publicación
  // `supabase_realtime` — migración 0044; antes de ella la publicación estaba vacía y no llegaba nada.
  useEffect(() => {
    const catchUp = async () => {
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("id, owner_id, wa_message_id, wa_phone_from, wa_phone_to, direction, body, media_type, read_at, delivered_at, failed_at, error_detail, created_at")
        .gt("created_at", cursorRef.current)
        .order("created_at", { ascending: true })
        .limit(200)
      applyFresh((data as InboxMessage[] | null) ?? [])
    }

    const channel = supabase
      .channel("whatsapp-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_messages" },
        (payload) => applyFresh([desdeRealtime(payload.new as InboxMessage)]),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "whatsapp_messages" },
        (payload) => {
          // Los ticks de entregado/leído y los fallos de envío llegan como UPDATE de la fila.
          // `desdeRealtime` es imprescindible acá: la fusión trae `created_at` entero, así que sin
          // normalizar cada tick pisaba una fecha buena con la del WAL y desordenaba el hilo.
          const row = desdeRealtime(payload.new as InboxMessage)
          setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)))
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void catchUp()
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, applyFresh])

  // Al abrir una conversación: marcar leídos los entrantes + cargar propuestas de Athos pendientes
  // (sobreviven recargas: son filas 'proposed' de athos_actions, RLS por clínica).
  const openConversation = useCallback(
    (phone: string) => {
      setSelected(phone)
      setShowNew(false)
      setPendingActionId(null)
      setProposals([])
      void supabase
        .from("athos_actions")
        .select("id, tool_name, summary, payload, status, created_at")
        .eq("conversation_key", phone)
        .eq("status", "proposed")
        .order("created_at", { ascending: true })
        .then(({ data }) => setProposals((data as ProposedAction[] | null) ?? []))
      const unreadIds = messages
        .filter((m) => contactOf(m) === phone && m.direction === "inbound" && !m.read_at)
        .map((m) => m.id)
      if (unreadIds.length) {
        const now = new Date().toISOString()
        setMessages((prev) => prev.map((m) => (unreadIds.includes(m.id) ? { ...m, read_at: now } : m)))
        void supabase
          .from("whatsapp_messages")
          .update({ read_at: now })
          .in("id", unreadIds)
          .then(({ error }) => {
            if (error) toast.error(`No se pudieron marcar los leídos: ${error.message}`)
          })
      }
    },
    [messages, supabase],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "instant", block: "end" })
  }, [thread.length, selected])

  // Sugerencia de Athos (agent_mode=review): el agente lee la conversación y PROPONE una respuesta
  // — persistida en athos_actions (sobrevive recargas, auditada). El composer queda EDITABLE y
  // "Enviar" es la aprobación de esa acción.
  async function suggestReply() {
    if (!selected || suggesting) return
    setSuggesting(true)
    try {
      const owner = ownerByPhone.get(selected.slice(-10))
      const res = await fetch("/api/athos/suggest-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selected, owner_id: owner?.id ?? null, owner_name: owner?.full_name ?? null }),
      })
      const j = (await res.json().catch(() => ({}))) as { draft?: string; action_id?: string; error?: string }
      if (!res.ok || !j.draft || !j.action_id) throw new Error(j.error ?? `HTTP ${res.status}`)
      setDraft(j.draft)
      setPendingActionId(j.action_id)
      toast.success("Borrador de Athos listo — revisalo y editalo; enviar = aprobar")
    } catch (e) {
      toast.error(`No se pudo generar la sugerencia: ${(e as Error).message}`)
    } finally {
      setSuggesting(false)
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || !draft.trim()) return
    setSending(true)
    try {
      const owner = ownerByPhone.get(selected.slice(-10))
      // Si el borrador viene de una propuesta de Athos, enviarlo ES aprobar esa acción (con el
      // texto final como override si el vet lo editó). Si no, envío directo normal.
      const res = pendingActionId
        ? await fetch(`/api/athos/actions/${pendingActionId}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload_override: { body: draft.trim() } }),
          })
        : await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: selected, body: draft.trim(), owner_id: owner?.id ?? null }),
          })
      const raw = (await res.json().catch(() => ({}))) as {
        error?: string
        warning?: string
        wa_message_id?: string
        message?: { id: string; created_at: string } | null
        result?: { wa_message_id?: string; message?: { id: string; created_at: string } | null }
      }
      if (!res.ok) throw new Error(raw.error ?? `HTTP ${res.status}`)
      const j = {
        warning: raw.warning,
        wa_message_id: raw.wa_message_id ?? raw.result?.wa_message_id,
        message: raw.message ?? raw.result?.message ?? null,
      }
      if (pendingActionId) {
        setPendingActionId(null)
        setProposals((prev) => prev.filter((a) => a.id !== pendingActionId))
      }
      if (j.warning) toast.warning(j.warning)
      // La API devuelve la fila REAL (id + created_at de la BD): el hilo no duplica y el poll
      // la reconoce por id. Si el registro falló (warning), no hay fila que mostrar.
      if (j.message) {
        const real: InboxMessage = {
          id: j.message.id,
          owner_id: owner?.id ?? null,
          wa_message_id: j.wa_message_id ?? null,
          wa_phone_from: clinicPhone,
          wa_phone_to: selected,
          direction: "outbound",
          body: draft.trim(),
          media_type: null,
          read_at: null,
          delivered_at: null,
          failed_at: null,
          error_detail: null,
          created_at: j.message.created_at,
        }
        setMessages((prev) => (prev.some((p) => p.id === real.id) ? prev : [...prev, real]))
      }
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
            <div className="flex flex-col gap-2 p-4 text-sm text-muted-foreground">
              <p>
                Sin conversaciones aún. Cuando un titular escriba al WhatsApp de la clínica,
                aparecerá acá.
              </p>
              <Link
                href="/dashboard/conexiones"
                className="text-xs font-medium text-primary hover:underline"
              >
                ¿Todavía no conectas el WhatsApp de la clínica?
              </Link>
            </div>
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
                        (m.failed_at ? (
                          <span className="inline-flex items-center gap-0.5 text-red-300" title={m.error_detail ?? "No se pudo entregar"}>
                            <CircleAlert className="size-3" /> No entregado
                          </span>
                        ) : m.read_at ? (
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
            {proposals.filter((a) => a.id !== pendingActionId).length > 0 && (
              <div className="flex flex-col gap-2 border-t bg-muted/30 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Propuestas de Athos pendientes
                </span>
                {proposals
                  .filter((a) => a.id !== pendingActionId)
                  .map((a) => (
                    <ActionApprovalCard
                      key={a.id}
                      action={a}
                      onResolved={(id) => setProposals((prev) => prev.filter((x) => x.id !== id))}
                    />
                  ))}
              </div>
            )}
            <form onSubmit={send} className="flex items-center gap-2 border-t p-3">
              <Button
                type="button"
                variant="outline"
                onClick={suggestReply}
                disabled={suggesting || sending}
                title="Athos redacta un borrador; vos lo editás y aprobás al enviar"
              >
                {suggesting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                <span className="hidden sm:inline">Sugerir</span>
              </Button>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escribe un mensaje…  (o pedile un borrador a Athos)"
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

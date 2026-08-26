"use client"

// Bandeja de WhatsApp — master-detail: conversaciones a la izquierda (agrupadas por teléfono del
// contacto), hilo a la derecha con composer. Entrantes via webhook, que aterrizan en la pantalla al
// instante por Realtime (con RLS por clínica); salientes via /api/whatsapp/send (los ticks de
// entregado/leído los escribe el webhook y llegan como UPDATE de la misma fila).
// Al abrir una conversación se marcan leídos los entrantes (policy UPDATE, migración 0018).

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, CheckCheck, CircleAlert, Loader2, MessageCircle, Paperclip, Plus, Send, Sparkles, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { normalizarFilaRealtime } from "@/lib/realtime-timestamp"
import { ActionApprovalCard, type ProposedAction } from "@/components/athos/action-approval-card"
import { CreateOwnerDrawer } from "@/components/create-owner-drawer"
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
  /** Ruta dentro del bucket privado `whatsapp-media`, no una URL: se firma al pintarla. */
  media_url: string | null
  read_at: string | null
  delivered_at: string | null
  /**
   * Nombre de perfil de WhatsApp de quien escribió (`pushName`), sólo en entrantes.
   *
   * NO ES IDENTIDAD VERIFICADA: lo elige el remitente. Se pinta distinto de un titular a propósito.
   */
  push_name?: string | null
  failed_at?: string | null
  error_detail?: string | null
  created_at: string
  /** Hora del proveedor. El hilo se ORDENA por esta; `created_at` es sólo la hora de llegada. */
  provider_timestamp: string
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
// `provider_timestamp` va en la lista por la misma razón, y le importa MÁS que a las otras: es la
// clave con la que se ordena el hilo. Un valor en formato WAL comparado como string contra los ISO
// que trajo PostgREST ordena mal, que es exactamente el defecto que este cambio viene a cerrar.
const CAMPOS_FECHA = ["created_at", "provider_timestamp", "read_at", "delivered_at", "failed_at"] as const

const desdeRealtime = (row: InboxMessage): InboxMessage =>
  normalizarFilaRealtime(row, CAMPOS_FECHA)

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" })
}

const MEDIA_BUCKET = "whatsapp-media"
const SIGNED_URL_TTL = 60 * 60

// Etiqueta legible de lo que llegó, para cuando no hay (o todavía no hay) bytes.
const NOMBRE_MEDIA: Record<string, string> = {
  image: "Foto",
  sticker: "Sticker",
  video: "Video",
  audio: "Audio",
  document: "Documento",
}
const nombreMedia = (t: string | null) => (t && NOMBRE_MEDIA[t]) ?? "Adjunto"

// La foto que mandó el titular. `media_url` es una RUTA del bucket privado, no una URL: se firma con
// la sesión del vet, así que la RLS de storage vuelve a comprobar la clínica en cada firma.
//
// El texto plano que hay debajo (`[adjunto]`) no desaparece: sigue siendo lo que se ve mientras los
// bytes no estén. La descarga corre en `after()` después del webhook, o sea que hay una ventana —
// corta— en la que el mensaje ya existe y la foto todavía no. Y si la descarga falló, esa etiqueta
// es lo que queda para siempre, que es mejor que un hueco sin explicación.
function MediaAdjunta({ path, tipo }: { path: string; tipo: string | null }) {
  const [supabase] = useState(() => createClient())
  const [url, setUrl] = useState<string | null>(null)
  // Se distingue "todavía no llegó la firma" de "la firma falló": sin esta bandera, una imagen que
  // no se puede firmar no pinta NADA y tampoco cae en la etiqueta de respaldo (que se salta porque
  // sí hay `media_url`). Quedaba un hueco mudo en el hilo, sin forma de saber que algo llegó.
  const [sinFirma, setSinFirma] = useState(false)
  const [abriendo, setAbriendo] = useState(false)
  const esImagen = tipo === "image" || tipo === "sticker"

  useEffect(() => {
    if (!esImagen) return
    let vivo = true
    void supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL)
      .then(({ data, error }) => {
        if (!vivo) return
        if (data?.signedUrl) setUrl(data.signedUrl)
        else {
          console.warn(`whatsapp/media: no se pudo firmar ${path}`, error?.message)
          setSinFirma(true)
        }
      })
    return () => {
      vivo = false
    }
  }, [supabase, path, esImagen])

  // Lo que no es imagen se firma al hacer clic, no al pintar: un hilo con veinte notas de voz no
  // tiene por qué disparar veinte firmas que nadie va a usar.
  async function abrir() {
    setAbriendo(true)
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
    setAbriendo(false)
    if (error || !data?.signedUrl) {
      toast.error(`No se pudo abrir el ${nombreMedia(tipo).toLowerCase()}: ${error?.message ?? "no disponible"}`)
      return
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer")
  }

  // Mientras la firma viaja no se pinta nada (es un instante y un esqueleto parpadearía). Si falló,
  // se cae al mismo botón que el resto de adjuntos: al menos se ve QUE llegó una foto y se puede
  // reintentar tocándola.
  if (esImagen && !sinFirma) {
    if (!url) return null
    return (
      <button type="button" onClick={abrir} className="block cursor-zoom-in">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={nombreMedia(tipo)}
          className="max-h-64 w-full rounded-lg object-cover"
          loading="lazy"
        />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={abrir}
      disabled={abriendo}
      className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs underline-offset-2 hover:underline disabled:opacity-60"
    >
      {abriendo ? <Loader2 className="size-3 animate-spin" /> : <Paperclip className="size-3" />}
      {nombreMedia(tipo)}
    </button>
  )
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
  const router = useRouter()
  const [selected, setSelected] = useState<string | null>(null) // teléfono (dígitos) del contacto
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [showNew, setShowNew] = useState(false)
  // Sugerencia de VetGPT = acción 'proposed' persistida: enviar el borrador es APROBARLA.
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [proposals, setProposals] = useState<ProposedAction[]>([])
  const endRef = useRef<HTMLDivElement | null>(null)

  // Nombre del contacto: por owner_id del mensaje o match de teléfono con titulares.
  const ownerByPhone = useMemo(() => {
    const map = new Map<string, InboxOwner>()
    for (const o of owners) if (o.phone) map.set(digits(o.phone).slice(-10), o)
    return map
  }, [owners])
  /**
   * El nombre de perfil MÁS RECIENTE por teléfono.
   *
   * La gente cambia su nombre de WhatsApp, y cada mensaje guarda el que tenía al escribir: se
   * recorre en orden y gana el último. Sólo entrantes — en un saliente el `pushName` es el de la
   * clínica.
   */
  const perfilPorTelefono = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of messages) {
      if (m.direction !== "inbound") continue
      const nombre = m.push_name?.trim()
      if (nombre) map.set(digits(m.wa_phone_from).slice(-10), nombre)
    }
    return map
  }, [messages])

  /**
   * Cómo se llama una conversación.
   *
   * El orden importa y es el único posible: TITULAR primero —es el dato que la clínica verificó y
   * escribió— y sólo si no hay, el nombre de perfil de WhatsApp, que lo eligió quien escribe y
   * puede decir cualquier cosa. El número queda de último recurso.
   */
  const nameOf = useCallback(
    (phone: string) => {
      const clave = phone.slice(-10)
      return ownerByPhone.get(clave)?.full_name ?? perfilPorTelefono.get(clave) ?? `+${phone}`
    },
    [ownerByPhone, perfilPorTelefono],
  )

  /** Si el nombre que se está mostrando es el de perfil y no el de un titular. */
  const esNombreDePerfil = useCallback(
    (phone: string) => {
      const clave = phone.slice(-10)
      return !ownerByPhone.get(clave) && Boolean(perfilPorTelefono.get(clave))
    },
    [ownerByPhone, perfilPorTelefono],
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
        if (m.provider_timestamp > cur.last.provider_timestamp) cur.last = m
        cur.unread += unread
      }
    }
    return [...by.values()].sort((a, b) =>
      a.last.provider_timestamp < b.last.provider_timestamp ? 1 : -1,
    )
  }, [messages])

  // Ordenado por la hora del PROVEEDOR, no por la de llegada. `messages` está en orden de llegada
  // (así lo va llenando Realtime), y ese orden lo invierte cualquier reintento del webhook o dos
  // mensajes seguidos — el vet veía el hilo distinto de como el titular lo escribió.
  const thread = useMemo(
    () =>
      selected
        ? messages
            .filter((m) => contactOf(m) === selected)
            .sort((a, b) => (a.provider_timestamp < b.provider_timestamp ? -1 : 1))
        : [],
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
        .select("id, owner_id, wa_message_id, wa_phone_from, wa_phone_to, direction, body, media_type, media_url, read_at, delivered_at, failed_at, error_detail, created_at, provider_timestamp, push_name")
        // El cursor sigue siendo `created_at` A PROPÓSITO, aunque el hilo se ordene por la hora del
        // proveedor: ponerse al día necesita un reloj monótono de LLEGADA. Con `provider_timestamp`
        // un mensaje con hora vieja (reintento, o teléfono con el reloj atrasado) quedaría por
        // debajo del cursor y no se recuperaría nunca.
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

  // Al abrir una conversación: marcar leídos los entrantes + cargar propuestas de VetGPT pendientes
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

  // Sugerencia de VetGPT (agent_mode=review): el agente lee la conversación y PROPONE una respuesta
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
      toast.success("Borrador de VetGPT listo — revisalo y editalo; enviar = aprobar")
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
      // Si el borrador viene de una propuesta de VetGPT, enviarlo ES aprobar esa acción (con el
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
        message?: { id: string; created_at: string; provider_timestamp?: string } | null
        result?: {
          wa_message_id?: string
          message?: { id: string; created_at: string; provider_timestamp?: string } | null
        }
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
          media_url: null,
          read_at: null,
          delivered_at: null,
          failed_at: null,
          error_detail: null,
          created_at: j.message.created_at,
          // Viene de la BD igual que `created_at`. El respaldo existe porque este objeto se arma a
          // mano y una sola clave de orden ausente pone el mensaje recién enviado al principio del
          // hilo en vez de al final.
          provider_timestamp: j.message.provider_timestamp ?? j.message.created_at,
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
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{nameOf(c.phone)}</span>
                  {/* SE DISTINGUE DE UN TITULAR, y no es cosmético: este nombre lo eligió quien
                      escribe y puede decir «Servicio Técnico» o el nombre de otra persona. Sin la
                      marca, la bandeja afirmaría una identidad que nadie verificó. */}
                  {esNombreDePerfil(c.phone) && (
                    <span
                      title="Nombre de perfil de WhatsApp — no es un titular registrado"
                      className="shrink-0 rounded border px-1 text-[9px] uppercase tracking-wide text-muted-foreground"
                    >
                      WA
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(c.last.provider_timestamp)}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {c.last.direction === "outbound" ? "Tú: " : ""}
                  {c.last.body ?? nombreMedia(c.last.media_type)}
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
            {/* LA CABECERA DEL HILO, y el botón que convierte un número en un titular.
                Quien escribe desde un número que no está en la clínica aparece como «+573001234567»
                y hasta ahora la única salida era copiar el número a mano a la pantalla de Titulares.
                Peor: mientras no sea titular, VetGPT TAMPOCO le puede escribir —`athosPuedeEscribirA`
                sólo deja hablarle a titulares registrados— así que un número sin nombre es también
                un número sin respuesta. Guardarlo desbloquea las dos cosas de una. */}
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">{nameOf(selected)}</span>
                {esNombreDePerfil(selected) && (
                  <span className="text-[10px] text-muted-foreground">
                    Nombre de su perfil de WhatsApp · +{selected}
                  </span>
                )}
              </span>
              {!ownerByPhone.get(selected.slice(-10)) && (
                <CreateOwnerDrawer
                  label="Guardar como titular"
                  telefonoInicial={selected}
                  trigger={
                    <Button variant="outline" size="sm">
                      <UserPlus className="size-3.5" aria-hidden />
                      Guardar como titular
                    </Button>
                  }
                  alCrear={() => router.refresh()}
                />
              )}
            </div>
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
                    {m.media_url && (
                      <div className="mb-1">
                        <MediaAdjunta path={m.media_url} tipo={m.media_type} />
                      </div>
                    )}
                    {/* El pie de foto se pinta si lo hay; el marcador sólo cuando no hay NI texto ni
                        bytes, que es el caso en que hace falta decir que algo llegó. */}
                    {m.body ? (
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    ) : m.media_url ? null : (
                      <p className="whitespace-pre-wrap italic opacity-80">{nombreMedia(m.media_type)}</p>
                    )}
                    <span className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${m.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {fmtTime(m.provider_timestamp)}
                      {m.direction === "outbound" &&
                        (m.failed_at ? (
                          <span className="inline-flex items-center gap-0.5 text-danger" title={m.error_detail ?? "No se pudo entregar"}>
                            <CircleAlert className="size-3" /> No entregado
                          </span>
                        ) : m.read_at ? (
                          <CheckCheck className="size-3 text-info" />
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
                  Propuestas de VetGPT pendientes
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
                title="VetGPT redacta un borrador; vos lo editás y aprobás al enviar"
              >
                {suggesting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                <span className="hidden sm:inline">Sugerir</span>
              </Button>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escribe un mensaje…  (o pedile un borrador a VetGPT)"
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

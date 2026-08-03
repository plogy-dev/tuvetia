"use client"

// Bandeja de correo del veterinario — maestro-detalle, con los correos que vienen de Gmail vía
// Composio (los trae el server component, ver la página).
//
// No hay realtime ni estado sincronizado: lo que se ve es lo que Gmail devolvió al cargar. Para
// refrescar se recarga. Es un intercambio deliberado — mantener una copia viva del buzón costaba
// un barrido, deduplicación, hilado y guardar el correo de la clínica en nuestra base.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, Loader2, Mail, RefreshCw, Send } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/empty-state"
import type { CorreoBandeja } from "@/lib/composio/gmail"

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  const hoy = new Date()
  const mismoDia =
    d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate()
  return mismoDia
    ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" })
}

/** "Ana Restrepo <ana@x.com>" → "Ana Restrepo". Si no trae nombre, deja el correo. */
function soloNombre(direccion: string): string {
  const m = direccion.match(/^\s*"?([^"<]+?)"?\s*</)
  return (m?.[1] ?? direccion).trim()
}

function correoDe(direccion: string): string {
  return direccion.match(/<([^>]+)>/)?.[1] ?? direccion.trim()
}

export function EmailInbox({ correos }: { correos: CorreoBandeja[] }) {
  const router = useRouter()
  const [selId, setSelId] = useState<string | null>(correos[0]?.id ?? null)
  const [draft, setDraft] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [refrescando, setRefrescando] = useState(false)

  const sel = useMemo(() => correos.find((c) => c.id === selId) ?? null, [correos, selId])

  async function responder() {
    if (!sel || !draft.trim()) return
    setEnviando(true)
    try {
      const res = await fetch("/api/email/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: sel.threadId,
          to_email: correoDe(sel.de),
          subject: sel.asunto,
          body: draft.trim(),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setDraft("")
      toast.success("Respuesta enviada")
      router.refresh()
    } catch (e) {
      toast.error(`No se pudo enviar: ${(e as Error).message}`)
    } finally {
      setEnviando(false)
    }
  }

  if (correos.length === 0) {
    return (
      <div className="px-4 py-10 lg:px-6">
        <EmptyState
          title="No hay correos para mostrar"
          description="Cuando llegue algo a tu bandeja de Gmail, va a aparecer acá."
        />
      </div>
    )
  }

  return (
    <div className="grid h-[calc(100svh-var(--header-height)-4rem)] gap-4 px-4 py-4 lg:grid-cols-[minmax(260px,340px)_1fr] lg:px-6">
      {/* Maestro */}
      <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">{correos.length} correos</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRefrescando(true)
              router.refresh()
              // El refresh del router no expone cuándo terminó; el spinner es solo señal de que se
              // pidió, no de que llegó.
              setTimeout(() => setRefrescando(false), 1500)
            }}
            disabled={refrescando}
          >
            {refrescando ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Actualizar
          </Button>
        </div>
        <div className="flex flex-col gap-1 overflow-y-auto p-1.5">
          {correos.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelId(c.id)}
              className={`flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${
                c.id === selId ? "bg-primary/10" : "hover:bg-muted"
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className={`truncate text-sm ${c.leido ? "" : "font-semibold"}`}>
                  {c.esPropio ? `Para: ${soloNombre(c.para)}` : soloNombre(c.de)}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{fmtFecha(c.fecha)}</span>
              </span>
              <span className="line-clamp-1 w-full text-xs text-muted-foreground">{c.asunto}</span>
              <span className="line-clamp-1 w-full text-[11px] text-fg-faint">{c.preview}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Detalle */}
      <div className="flex min-h-0 flex-col rounded-xl border bg-card">
        {sel ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{sel.asunto}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {sel.esPropio ? `Para ${sel.para}` : `De ${sel.de}`} · {fmtFecha(sel.fecha)}
                  {sel.adjuntos > 0 && ` · 📎 ${sel.adjuntos}`}
                </div>
              </div>
              <a
                href={`https://mail.google.com/mail/u/0/#all/${sel.threadId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Ver en Gmail <ExternalLink className="size-3" />
              </a>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <p className="text-sm whitespace-pre-wrap">{sel.preview}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                Se muestra el comienzo del correo. Para leerlo completo, abrilo en Gmail.
              </p>
            </div>

            {!sel.esPropio && (
              <div className="flex items-end gap-2 border-t p-3">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Responder a ${soloNombre(sel.de)}…`}
                  className="min-h-16 flex-1 text-sm"
                  aria-label="Respuesta"
                />
                <Button onClick={responder} disabled={enviando || !draft.trim()}>
                  {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Responder
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-8" />
              Elegí un correo para leerlo.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

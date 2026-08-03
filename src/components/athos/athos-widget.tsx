"use client"

// Athos, alcanzable desde cualquier pantalla.
//
// EL HILO ES UNO SOLO (`id: "athos-widget"`), a diferencia de `asistente/assistant.tsx` que usa
// `athos-${patientId}` y resetea la conversación al cambiar de paciente. Acá es deliberado: el
// widget es una conversación que te SIGUE por la app. El paciente no define el hilo; viaja por
// mensaje en el body, igual que ya hace el asistente.
//
// El riesgo propio de eso es que "¿qué le doy?" cambie de significado al navegar. Se cubre con la
// etiqueta de contexto siempre visible arriba del composer: el vet ve, mientras escribe, sobre qué
// está preguntando.
//
// NO CUESTA NADA HASTA QUE SE USA: sin saludo automático, sin precarga de historial, sin consultas
// al montar. La burbuja cerrada es un botón.

import { useEffect, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Bot, Loader2, SendHorizontal, X } from "lucide-react"
import { toast } from "sonner"

import { AthosMensajes } from "@/components/athos/athos-mensajes"
import { useAthosContexto } from "@/components/athos/athos-provider"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

const transport = new DefaultChatTransport({ api: "/api/athos/agent" })

export function AthosWidget() {
  const ctx = useAthosContexto()
  const [abierto, setAbierto] = useState(false)
  const [input, setInput] = useState("")
  const hiloRef = useRef<HTMLDivElement>(null)
  const burbujaRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { messages, sendMessage, status } = useChat({
    id: "athos-widget",
    transport,
    onError: (e) => toast.error(`Athos no pudo responder: ${e.message}`),
  })
  const busy = status === "submitted" || status === "streaming"

  useEffect(() => {
    if (abierto) hiloRef.current?.scrollTo({ top: hiloRef.current.scrollHeight })
  }, [messages, status, abierto])

  // Al abrir, el foco entra al composer; al cerrar, vuelve a la burbuja. Sin trampa de foco: el
  // panel es NO modal a propósito — el sentido de un copiloto que sabe qué estás mirando es que
  // puedas seguir leyendo la pantalla de atrás mientras hablás con él.
  useEffect(() => {
    if (abierto) textareaRef.current?.focus()
    else burbujaRef.current?.focus({ preventScroll: true })
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [abierto])

  // Sin contexto (fuera del provider) o sin clínica (el instante previo al redirect a
  // /bienvenida) no hay nada útil que ofrecer, y el agente derivaría la clínica de la sesión igual.
  if (!ctx || !ctx.clinicId) return null

  function enviar(texto: string) {
    const t = texto.trim()
    if (!t || busy) return
    setInput("")
    void sendMessage({ text: t }, { body: { patientId: ctx!.patientId, source: "widget" } })
  }

  if (!abierto) {
    return (
      <button
        ref={burbujaRef}
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Abrir Athos"
        aria-expanded={false}
        className="pointer-events-auto grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Bot className="size-5" />
      </button>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Athos"
      className="pointer-events-auto flex h-[min(32rem,calc(100svh-6rem))] w-[min(23rem,calc(100vw-1.5rem))] flex-col rounded-2xl border bg-card shadow-xl"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Bot className="size-4" />
        </div>
        <p className="min-w-0 flex-1 text-sm font-semibold">Athos</p>
        <Button size="icon" variant="ghost" onClick={() => setAbierto(false)} aria-label="Cerrar Athos">
          <X className="size-4" />
        </Button>
      </header>

      <div ref={hiloRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Preguntame lo que necesites. Sé en qué parte de Tuvetia estás, así que no hace falta que
            me repitas el contexto. Todo lo que proponga lo aprobás vos.
          </p>
        )}
        <AthosMensajes messages={messages} />
        {busy && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Athos está escribiendo…
          </div>
        )}
      </div>

      {/* La etiqueta de contexto va pegada al composer y no en el encabezado: es donde el vet mira
          mientras escribe, y es lo que evita que "¿qué le doy?" cambie de significado sin que se
          entere. */}
      <p className="truncate border-t px-3 pt-2 text-[11px] text-muted-foreground">
        Estás en {ctx.descripcion}
      </p>

      <div className="flex items-end gap-2 px-3 pb-3 pt-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              enviar(input)
            }
          }}
          placeholder="Preguntale a Athos…"
          rows={1}
          className="max-h-28 min-h-9 resize-none text-sm"
        />
        <Button size="icon" onClick={() => enviar(input)} disabled={busy || !input.trim()} aria-label="Enviar">
          <SendHorizontal className="size-4" />
        </Button>
      </div>
    </div>
  )
}

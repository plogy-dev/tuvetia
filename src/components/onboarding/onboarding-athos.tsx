"use client"

// Athos acompañando el onboarding. Panel al lado del wizard: explica lo que el vet está viendo,
// responde dudas ("¿qué es el Modo Fantasma?") y puede cargar el primer paciente por él.
//
// POR QUÉ NO REUSA `asistente/assistant.tsx`. Ese componente es una PANTALLA: fija su propia altura
// (`h-[calc(100svh-...)]`), trae encabezado con selector de paciente, historial persistido por
// paciente y aviso de contexto. Extraerlo obligaba a refactorizar una pantalla de 367 líneas en uso
// diario para servir a un caso nuevo — el riesgo no compensa. Acá se reusa lo que SÍ está pensado
// para reusarse y ya está probado embebido fuera del chat: el mismo endpoint del agente
// (`/api/athos/agent`), `rich-text` para el formato y `ActionApprovalCard` para las propuestas
// (que ya vive también dentro de la bandeja de WhatsApp). El render del hilo se mudó a
// `athos/athos-mensajes.tsx` cuando el widget global lo necesitó — era la tercera copia.
//
// El agente propone y el vet aprueba, igual que en el resto del producto: nada de lo que Athos
// sugiera acá se ejecuta solo.

import { useEffect, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Bot, Loader2, SendHorizontal } from "lucide-react"
import { toast } from "sonner"

import { AthosMensajes } from "@/components/athos/athos-mensajes"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

const transport = new DefaultChatTransport({ api: "/api/athos/agent" })

const SUGERENCIAS = [
  "¿Qué es el Modo Fantasma?",
  "¿Cómo funciona el copiloto?",
  "¿Qué hago después de configurar la clínica?",
]

export function OnboardingAthos({ clinicName }: { clinicName: string }) {
  const [input, setInput] = useState("")
  const hiloRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status } = useChat({
    id: "athos-onboarding",
    transport,
    onError: (e) => toast.error(`Athos no pudo responder: ${e.message}`),
  })
  const busy = status === "submitted" || status === "streaming"

  useEffect(() => {
    hiloRef.current?.scrollTo({ top: hiloRef.current.scrollHeight })
  }, [messages, status])

  function enviar(texto: string) {
    const t = texto.trim()
    if (!t || busy) return
    setInput("")
    // Ya no miente: la 0057 amplió el CHECK de `athos_actions.source`. Antes mandaba "chat" porque
    // sólo se admitía chat|inbox|auto, y con dos superficies mintiendo (ésta y el widget) "chat"
    // dejaba de significar nada.
    void sendMessage({ text: t }, { body: { patientId: null, source: "onboarding" } })
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col rounded-2xl border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Bot className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Athos</p>
          <p className="truncate text-xs text-muted-foreground">
            Te acompaña mientras configuras {clinicName || "tu clínica"}
          </p>
        </div>
      </header>

      <div ref={hiloRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Puedo explicarte cualquier parte de Tuvetia mientras configuras, o cargarte el primer
              paciente si me dices sus datos. Tú apruebas todo antes de que se guarde.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  className="rounded-lg border bg-background px-3 py-2 text-left text-xs text-muted-foreground transition hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <AthosMensajes messages={messages} />

        {busy && (
          <div className="flex items-center gap-[9px] text-[13px] text-fg-faint">
            <Loader2 className="size-3.5 animate-spin" /> Athos está escribiendo…
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              enviar(input)
            }
          }}
          placeholder="Pregúntale a Athos…"
          rows={1}
          className="max-h-28 min-h-9 resize-none text-sm"
        />
        <Button size="icon" onClick={() => enviar(input)} disabled={busy || !input.trim()}>
          <SendHorizontal className="size-4" />
        </Button>
      </div>
    </aside>
  )
}

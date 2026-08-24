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
import { Bot, Loader2, SendHorizontal, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { AthosMensajes } from "@/components/athos/athos-mensajes"
import { useModalPro } from "@/components/planes/modal-subir-a-pro"
import { tieneAcceso, type Plan } from "@/lib/planes"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

const transport = new DefaultChatTransport({ api: "/api/athos/agent" })

const SUGERENCIAS = [
  "¿Qué es el Modo Fantasma?",
  "¿Cómo funciona el copiloto?",
  "¿Qué hago después de configurar la clínica?",
]

// EL PLAN LLEGA POR PROP, NO POR CONTEXTO, y no es un descuido: `PlanProvider` sólo envuelve
// `/dashboard`, y esta pantalla vive fuera. Con `useCapacidad` acá se leería el default del
// contexto —`free`, que es el correcto para "ante la duda, negar"— y una clínica Pro vería el muro
// de pago en su primera pantalla. La página ya lee la clínica: el plan viaja en ese mismo select.
export function OnboardingAthos({ clinicName, plan }: { clinicName: string; plan: Plan }) {
  const puedeUsarAthos = tieneAcceso(plan, "athos")
  const { pedirPro, ventana } = useModalPro("athos")
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

    // EL GATE, y acá pesa más que en ninguna otra pantalla: toda clínica nace en `free`
    // (`clinics.plan` default), así que ÉSTA es la primera vez que alguien le habla a Athos. Sin
    // esto, las tres sugerencias de arriba invitan a un clic que devuelve el toast de `onError`
    // —«Athos no pudo responder»— como primera impresión del producto.
    //
    // Cubre también los chips: los tres caminos —chip, Enter y botón— pasan por acá.
    if (!puedeUsarAthos) {
      pedirPro()
      return
    }

    setInput("")
    // Ya no miente: la 0057 amplió el CHECK de `athos_actions.source`. Antes mandaba "chat" porque
    // sólo se admitía chat|inbox|auto, y con dos superficies mintiendo (ésta y el widget) "chat"
    // dejaba de significar nada.
    void sendMessage({ text: t }, { body: { patientId: null, source: "onboarding" } })
  }

  return (
    <>
    {ventana}
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

      {!puedeUsarAthos && input.trim() ? (
        <p className="flex items-center gap-1.5 border-t px-3 pt-2 text-[11px] text-brand-text">
          <Sparkles className="size-3 shrink-0" aria-hidden />
          Athos es parte del plan Pro. Al enviar te mostramos cómo activarlo.
        </p>
      ) : null}

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
    </>
  )
}

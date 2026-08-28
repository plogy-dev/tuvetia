"use client"

// VetGPT acompañando el onboarding. Panel al lado del wizard: explica lo que el vet está viendo,
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
// El agente propone y el vet aprueba, igual que en el resto del producto: nada de lo que VetGPT
// sugiera acá se ejecuta solo.

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Loader2, SendHorizontal, Sparkles } from "lucide-react"

import { BrandGlyph } from "@/components/brand-glyph"
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

// TARJETA CONTEXTUAL: un texto FIJO por paso del wizard (pedido de la reunión del 24-ago: "que ese
// VetGPT que acompaña acompañe de verdad"). Acompaña porque habla de lo que el vet tiene DELANTE en
// cada paso — pero sin IA: texto quemado, cero llamadas de red, cero tokens. Cada texto dice para
// qué sirve el paso y qué desbloquea, que es lo que el wizard no tiene espacio para contar.
//
// El índice sigue a `PASOS` de `welcome-wizard.tsx` (Clínica, Horarios, Servicios, Primer paciente,
// Ejemplo, Equipo). Si allá se agrega o reordena un paso, esto se actualiza a mano — por eso el
// comentario por posición en cada línea.
const TARJETAS_POR_PASO = [
  /* Clínica */ "Este nombre y logo aparecen en tus documentos y recordatorios. Con el nombre ya alcanza para arrancar; el logo se puede sumar después.",
  /* Horarios */ "Tus horarios son los que me dejan ofrecer espacios libres y agendar citas por ti. Ya vienen llenos con lo habitual: ajusta solo lo que no cuadre.",
  /* Servicios */ "Con al menos un servicio con precio ya puedes facturar. Los nombres vienen sugeridos; tú solo les pones tu precio.",
  /* Primer paciente */ "Carga tu primer paciente para ver la ficha completa en acción. Después puedes importar el resto desde Excel.",
  /* Ejemplo */ "Luna es una paciente de ejemplo, con consulta transcrita y nota en borrador, para que explores sin miedo a romper nada. La borras cuando quieras.",
  /* Equipo */ "Invita a un colega con su correo y entra con su propia cuenta. Este paso se puede saltar: también puedes invitar después desde Configuración.",
] as const

// EL PLAN LLEGA POR PROP, NO POR CONTEXTO, y no es un descuido: `PlanProvider` sólo envuelve
// `/dashboard`, y esta pantalla vive fuera. Con `useCapacidad` acá se leería el default del
// contexto —`free`, que es el correcto para "ante la duda, negar"— y una clínica Pro vería el muro
// de pago en su primera pantalla. La página ya lee la clínica: el plan viaja en ese mismo select.
export function OnboardingAthos({
  clinicName,
  plan,
  paso,
}: {
  clinicName: string
  plan: Plan
  /** Paso actual del wizard (índice en sus `PASOS`). Mueve la tarjeta contextual; el chat no lo usa. */
  paso: number
}) {
  const puedeUsarAthos = tieneAcceso(plan, "athos")
  const { pedirPro, ventana } = useModalPro("athos")
  const [input, setInput] = useState("")
  const hiloRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status } = useChat({
    id: "athos-onboarding",
    transport,
    onError: (e) => toast.error(`VetGPT no pudo responder: ${e.message}`),
  })
  const busy = status === "submitted" || status === "streaming"

  useEffect(() => {
    hiloRef.current?.scrollTo({ top: hiloRef.current.scrollHeight })
  }, [messages, status])

  function enviar(texto: string) {
    const t = texto.trim()
    if (!t || busy) return

    // EL GATE, y acá pesa más que en ninguna otra pantalla: toda clínica nace en `free`
    // (`clinics.plan` default), así que ÉSTA es la primera vez que alguien le habla a VetGPT. Sin
    // esto, las tres sugerencias de arriba invitan a un clic que devuelve el toast de `onError`
    // —«VetGPT no pudo responder»— como primera impresión del producto.
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
    // EL PASO VIAJA AL MODELO, no sólo a la tarjeta. Pedido de Luciano: «que sepa también dónde
    // estás parado». Hasta acá `paso` movía únicamente el texto fijo de `TarjetaDePaso` — el
    // comentario de su prop lo decía: «el chat no lo usa».
    void sendMessage(
      { text: t },
      { body: { patientId: null, source: "onboarding", contexto: { tipo: "onboarding", paso } } },
    )
  }

  return (
    <>
    {ventana}
    <aside className="flex h-full min-h-0 w-full flex-col rounded-2xl border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          {/* El glifo de la marca, como en todas las caras del asistente (25-ago). */}
          <BrandGlyph className="size-4" fill="currentColor" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">VetGPT</p>
          <p className="truncate text-xs text-muted-foreground">
            Te acompaña mientras configuras {clinicName || "tu clínica"}
          </p>
        </div>
      </header>

      {/* La tarjeta va FUERA del hilo con scroll: acompaña al paso actual del wizard, así que tiene
          que seguir a la vista aunque el chat crezca. El chat de abajo no cambia en nada. */}
      <TarjetaDePaso paso={paso} />

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

        <AthosMensajes
          messages={messages}
          streaming={status === "streaming"}
          onOpcion={(t) => enviar(t)}
        />

        {busy && (
          <div className="flex items-center gap-[9px] text-[13px] text-fg-faint">
            <Loader2 className="size-3.5 animate-spin" /> VetGPT está escribiendo…
          </div>
        )}
      </div>

      {!puedeUsarAthos && input.trim() ? (
        <p className="flex items-center gap-1.5 border-t px-3 pt-2 text-[11px] text-brand-text">
          <Sparkles className="size-3 shrink-0" aria-hidden />
          VetGPT es parte del plan Pro. Al enviar te mostramos cómo activarlo.
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
          placeholder="Pregúntale a VetGPT…"
          rows={1}
          className="max-h-28 min-h-9 resize-none text-sm"
        />
        {/* `aria-label` — es un botón de sólo icono, así que sin esto no tiene NINGÚN nombre
            accesible: un lector de pantalla lo anuncia como «botón» a secas y no hay forma de saber
            que es el de enviar. El icono va `aria-hidden` para que no intente leerlo como contenido. */}
        <Button
          size="icon"
          onClick={() => enviar(input)}
          disabled={busy || !input.trim()}
          aria-label="Enviar mensaje a VetGPT"
        >
          <SendHorizontal className="size-4" aria-hidden />
        </Button>
      </div>
    </aside>
    </>
  )
}

// `prefers-reduced-motion` como suscripción externa y no como chequeo dentro del efecto: el render
// necesita saberlo (quien pidió quietud no debe ver los punticos NI un frame), en el efecto no se
// puede setear estado síncrono (regla `react-hooks/set-state-in-effect`), y de paso el valor se
// actualiza si el usuario cambia la preferencia con la página abierta.
const QUIETO = "(prefers-reduced-motion: reduce)"
function suscribirQuieto(avisar: () => void) {
  const mq = window.matchMedia(QUIETO)
  mq.addEventListener("change", avisar)
  return () => mq.removeEventListener("change", avisar)
}

/**
 * La tarjeta contextual con su teatrito de "escribiendo".
 *
 * Al cambiar de paso muestra ~600 ms de tres punticos y recién entonces el texto — hace sentir que
 * VetGPT reacciona a lo que el vet acaba de hacer, sin gastar un token: es CSS y un timeout, cero
 * red. Con `prefers-reduced-motion` no hay teatro y el texto aparece directo.
 */
function TarjetaDePaso({ paso }: { paso: number }) {
  // Fuera de rango no debería pasar (el wizard tiene 6 pasos), pero un paso nuevo allá no puede
  // dejar esta tarjeta en blanco: ante la duda se cae al texto de "Clínica", que es el más general.
  const texto = TARJETAS_POR_PASO[paso] ?? TARJETAS_POR_PASO[0]

  // En el servidor la preferencia no se conoce: se asume quietud, que renderiza el texto directo —
  // el default que no le molesta a nadie mientras el cliente hidrata y responde de verdad.
  const prefiereQuieto = useSyncExternalStore(
    suscribirQuieto,
    () => window.matchMedia(QUIETO).matches,
    () => true,
  )

  // `pasoMostrado` corre DETRÁS de `paso`: mientras no lo alcanza, la tarjeta está "escribiendo".
  // El estado se deriva así porque todo setState debe pasar por el timeout (asíncrono), nunca por
  // el cuerpo del efecto. Con quietud el timer es de 0 ms: no anima, pero DEJA SINCRONIZADO
  // `pasoMostrado` — si la preferencia cambiara después, no quedan punticos colgados sin timer que
  // los apague.
  const [pasoMostrado, setPasoMostrado] = useState(paso)
  useEffect(() => {
    if (pasoMostrado === paso) return
    const t = window.setTimeout(() => setPasoMostrado(paso), prefiereQuieto ? 0 : 600)
    return () => window.clearTimeout(t)
  }, [paso, pasoMostrado, prefiereQuieto])

  const escribiendo = !prefiereQuieto && pasoMostrado !== paso

  // `aria-live` para que el lector de pantalla anuncie el texto nuevo al avanzar de paso; los
  // punticos van con `aria-hidden` para que ese anuncio no sea "cargando" tres veces.
  return (
    <div className="border-b bg-muted/40 px-4 py-3" aria-live="polite">
      {escribiendo ? (
        <span className="flex min-h-8 items-center gap-1" aria-hidden>
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
        </span>
      ) : (
        <p className="min-h-8 text-xs leading-relaxed text-muted-foreground">{texto}</p>
      )}
    </div>
  )
}

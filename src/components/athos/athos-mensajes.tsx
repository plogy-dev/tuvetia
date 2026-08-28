"use client"

// El hilo de mensajes de VetGPT: burbujas, bloques de texto y tarjetas de propuesta.
//
// Salió TAL CUAL de `onboarding/onboarding-athos.tsx` cuando apareció el widget global y hubo tres
// copias del mismo render. Se extrajo de ahí y no de `asistente/assistant.tsx` a propósito: el
// onboarding es la copia más chica y de menor tráfico, así que mover ese código es demostrablemente
// un movimiento y no una refactorización de una pantalla en uso clínico diario.
//
// `assistant.tsx` sigue con la suya. Quedan dos copias en vez de tres, y la que se toca de acá en
// adelante es ésta.
//
// ── LAS DOS COPIAS YA ESTÁN A LA MISMA ESCALA (22-ago) ──────────────────────────────────────────
//
// `assistant.tsx` bajó a la densidad del prototipo en el #131 y ésta se quedó atrás: burbujas de
// 16px de radio, texto de 14px y la respuesta de VetGPT dentro de un recuadro con borde. O sea que
// el mismo hilo se veía de dos maneras según si estabas en la pantalla completa o en el widget.
//
// Ahora comparten geometría y escala —14px de radio con la esquina asimétrica, 13,5px de texto, la
// respuesta sin burbuja— y se separan sólo donde el ancho lo obliga: acá no va el avatar de 26px,
// porque en 368px cuesta 37px con el gap y la alineación ya dice quién habla.

import { getToolName as getStaticToolName, type ToolUIPart, type UIMessage } from "ai"
import { Loader2 } from "lucide-react"

import { ActionApprovalCard } from "@/components/athos/action-approval-card"
import { Cuestionario } from "@/components/athos/cuestionario"
import { extraerOpciones, sinMarcas } from "@/components/athos/opciones"
import { renderInline, splitBlocks } from "@/components/athos/rich-text"

/** Una tool de ESCRITURA no ejecuta: devuelve la acción ya registrada como propuesta. */
export function comoPropuesta(output: unknown): { action_id: string; summary: string } | null {
  if (!output || typeof output !== "object") return null
  const o = output as Record<string, unknown>
  return typeof o.action_id === "string" && o.status === "proposed" && typeof o.summary === "string"
    ? { action_id: o.action_id, summary: o.summary }
    : null
}

export function AthosMensajes({
  messages,
  onOpcion,
  streaming = false,
}: {
  messages: UIMessage[]
  /** Recibe la respuesta compuesta del cuestionario ```opciones``` (auditoría 26-ago: sin esto,
   *  el widget y el onboarding pintaban el bloque CRUDO). Solo el último turno lo ofrece. */
  onOpcion?: (texto: string) => void
  /** Si el último mensaje sigue streameando: gobierna cómo se recorta un bloque incompleto. */
  streaming?: boolean
}) {
  const ultimoAsistente = [...messages].reverse().find((m) => m.role === "assistant")?.id
  return (
    <>
      {messages.map((m) => (
        <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
          {m.role === "user" ? (
            // LA BURBUJA DEL VET, a la geometría del prototipo: 14px de radio con la esquina de
            // abajo-derecha en 4px. La asimetría es lo que la "apoya" del lado de quien escribe, y
            // es lo que hacía que la nuestra —redonda por los cuatro lados— flotara.
            //
            // Y EN SUPERFICIE, NO EN MENTA. Era `bg-primary`, o sea el verde pleno del sistema, que
            // es el color de ACCIÓN: lo usan los botones primarios. Gastarlo en cada turno del vet
            // lo devalúa y compite con lo único que ahí hay que mirar, que es la respuesta.
            <div className="max-w-[80%] break-words whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-surface-2 px-3.5 py-2.5 text-[13.5px] leading-normal text-fg">
              {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {m.parts.map((p, i) => {
                if (p.type === "text") {
                  // Marcas internas fuera y el bloque ```opciones``` separado del texto (módulo
                  // compartido con assistant.tsx — auditoría 26-ago). Las opciones solo se
                  // OFRECEN en el último turno con VetGPT quieto: responder una pregunta de hace
                  // tres turnos ya no tiene destinatario.
                  const esUltimo = m.id === ultimoAsistente
                  const { limpio, preguntas } = extraerOpciones(
                    sinMarcas(p.text),
                    streaming && esUltimo,
                  )
                  if (!limpio && preguntas.length === 0) return null
                  return (
                    // LA RESPUESTA NO VA EN BURBUJA. En el prototipo —y ya en `assistant.tsx`— lo
                    // que dice VetGPT fluye sobre el fondo: la burbuja es del que pregunta. Acá
                    // además se paga: en un panel de 368px el borde y el padding se comían ~32px
                    // de ancho de lectura en la superficie donde menos sobra.
                    //
                    // SIN AVATAR, a diferencia de la pantalla completa. Ahí el avatar de 26px
                    // separa los turnos en una columna de 780px; acá costaría 37px con el gap para
                    // decir algo que la alineación ya dice — la del vet va a la derecha, la de
                    // VetGPT a la izquierda, y no hay un tercer interlocutor posible.
                    //
                    // SIN RAYAS entre bloques (paridad con assistant.tsx, que las quitó en el
                    // #131): los párrafos se separan con espacio, no con una planilla.
                    <div key={i} className="flex flex-col gap-2 text-[13.5px] leading-[1.55] text-fg">
                      {splitBlocks(limpio).map((blk, j) => (
                        <div key={j}>{renderInline(blk.text, [], `${m.id}-${i}-${j}`)}</div>
                      ))}
                      {preguntas.length > 0 && esUltimo && !streaming && onOpcion && (
                        <Cuestionario preguntas={preguntas} onResponder={onOpcion} />
                      )}
                    </div>
                  )
                }
                if (p.type.startsWith("tool-")) {
                  const part = p as ToolUIPart
                  if (part.state === "output-available") {
                    const prop = comoPropuesta(part.output)
                    if (prop) {
                      return (
                        <ActionApprovalCard
                          key={i}
                          action={{
                            id: prop.action_id,
                            tool_name: String(getStaticToolName(part)),
                            summary: prop.summary,
                            payload: (part.input ?? {}) as Record<string, unknown>,
                            status: "proposed",
                          }}
                        />
                      )
                    }
                    return null
                  }
                  // La misma escala que el resto del hilo: 13px y el gris tenue del prototipo.
                  // A 12px y `muted-foreground` se leía como un pie de página en vez de como el
                  // turno que todavía está por llegar.
                  return (
                    <div key={i} className="flex items-center gap-[9px] text-[13px] text-fg-faint">
                      <Loader2 className="size-3.5 animate-spin" /> Consultando…
                    </div>
                  )
                }
                return null
              })}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

"use client"

// Cuestionario de contexto de VetGPT — la versión Tuvetia del patrón de preguntas de Claude
// (pedido del cliente, 25-ago: "opciones múltiples para cada pregunta, poder escribir algo no
// contemplado, y que nada se envíe hasta resolver todo el cuestionario").
//
// El agente emite un bloque ```opciones``` con 1-3 preguntas (ver system-prompt.ts). Aquí cada
// pregunta ofrece sus opciones como chips + un campo "Otro" de texto libre; el botón de enviar
// se habilita SOLO cuando todas tienen respuesta, y sale UN mensaje compuesto — así el modelo
// recibe el contexto completo de una vez en lugar de gotear medias respuestas.

import { useState } from "react"
import { Send } from "lucide-react"

import { Button } from "@/components/ui/button"

export type PreguntaDeContexto = { pregunta: string; opciones: string[] }

// Una respuesta puede llevar VARIAS opciones (pedido del cliente 26-ago: un cuadro clínico rara
// vez es una sola cosa — "cojera aguda" Y "con fiebre" conviven) más el texto libre como respuesta
// ADICIONAL para lo no contemplado. Todo se acumula; nada se excluye.
type Respuesta = { opciones: string[]; libre: string }

const VACIA: Respuesta = { opciones: [], libre: "" }

function resuelta(r: Respuesta | undefined): boolean {
  return Boolean(r && (r.opciones.length > 0 || r.libre.trim()))
}

/**
 * Compone el mensaje que viaja al agente: una línea "Pregunta: respuesta[, respuesta…]" por
 * pregunta. Exportada para fijar el formato en tests — el system prompt le promete al modelo
 * esta forma (y le avisa que pueden venir varias respuestas separadas por coma).
 */
export function componerRespuestas(
  preguntas: PreguntaDeContexto[],
  respuestas: Record<number, Respuesta>,
): string {
  return preguntas
    .map((p, i) => {
      const r = respuestas[i] ?? VACIA
      const valores = [...r.opciones, ...(r.libre.trim() ? [r.libre.trim()] : [])].join(", ")
      return p.pregunta ? `${p.pregunta}: ${valores}` : valores
    })
    .join("\n")
}

export function Cuestionario({
  preguntas,
  onResponder,
}: {
  preguntas: PreguntaDeContexto[]
  /** Recibe el mensaje ya compuesto; el padre lo envía por el mismo camino que el compositor. */
  onResponder: (texto: string) => void
}) {
  const [respuestas, setRespuestas] = useState<Record<number, Respuesta>>({})
  const todas = preguntas.every((_, i) => resuelta(respuestas[i]))

  const fijar = (i: number, r: Respuesta) => setRespuestas((prev) => ({ ...prev, [i]: r }))

  return (
    // La tarjeta usa los tokens del sistema (line/surface/brand): debe leerse como parte de la
    // respuesta de VetGPT, no como un modal ajeno.
    <div className="mt-1 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3.5">
      {preguntas.map((p, i) => {
        const r = respuestas[i] ?? VACIA
        return (
          <div key={i} className="flex flex-col gap-1.5">
            {p.pregunta && (
              <span className="text-[12.5px] font-semibold text-fg">{p.pregunta}</span>
            )}
            <div className="flex flex-wrap gap-[7px]">
              {p.opciones.map((o) => {
                const activa = r.opciones.includes(o)
                return (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={activa}
                    onClick={() =>
                      fijar(i, {
                        ...r,
                        opciones: activa
                          ? r.opciones.filter((x) => x !== o)
                          : [...r.opciones, o],
                      })
                    }
                    className={
                      activa
                        ? "rounded-full border border-brand bg-brand-soft px-3 py-1.5 text-[12.5px] font-semibold text-brand-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        : "rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-fg-muted transition-colors hover:border-brand hover:bg-brand-soft hover:text-brand-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    }
                  >
                    {o}
                  </button>
                )
              })}
            </div>
            {/* "Otro": siempre visible, chico. Se SUMA a los chips elegidos, no los reemplaza —
                el detalle que no está contemplado suele acompañar a una opción, no excluirla. */}
            <input
              value={r.libre}
              onChange={(e) => fijar(i, { ...r, libre: e.target.value })}
              placeholder="Otro (agrégalo)…"
              aria-label={p.pregunta ? `Otra respuesta para: ${p.pregunta}` : "Otra respuesta"}
              className="h-8 w-full max-w-[340px] rounded-lg border border-line bg-transparent px-2.5 text-[12.5px] outline-none placeholder:text-fg-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
            />
          </div>
        )
      })}
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5">
        <span className="text-[11.5px] text-fg-faint">
          {todas
            ? "Listo — se envía todo junto."
            : `Responde ${preguntas.length === 1 ? "la pregunta" : "todas las preguntas"} para enviar.`}
        </span>
        <Button
          size="sm"
          disabled={!todas}
          onClick={() => onResponder(componerRespuestas(preguntas, respuestas))}
          className="h-[30px] shrink-0 rounded-[7px] px-3 text-[12.5px]"
        >
          Responder
          <Send className="size-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

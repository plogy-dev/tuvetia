"use client"

// La espera de Athos, viva (pedido del cliente, 26-ago): con turnos que legítimamente pueden
// tardar, un "Athos está pensando…" ESTÁTICO durante 40 segundos se lee como un bug — el vet no
// distingue "está trabajando" de "se colgó". Dos señales lo resuelven:
//
//  1. TRES PUNTOS QUE LATEN (el lenguaje universal de "alguien está escribiendo"): movimiento
//     continuo, CSS puro, sin red. Con prefers-reduced-motion quedan quietos.
//  2. LA FRASE EVOLUCIONA con el tiempo de espera. No inventa actividad ("consultando la base…"
//     cuando no se sabe qué pasa sería mentir): solo reconoce que sigue ahí y que lo largo es
//     esperable. El cambio de frase es en sí la señal de vida más fuerte — algo que cambia no
//     está colgado.
//
// Compartido entre el chat del asistente y el widget para que la espera se sienta igual en toda
// la app.

import { useEffect, useState } from "react"

/**
 * La frase según cuántos segundos lleva esperando. Pura y exportada para fijarla en tests:
 * el orden y los umbrales son producto, no decoración.
 */
export function fraseDeEspera(segundos: number): string {
  if (segundos < 7) return "Athos está pensando…"
  if (segundos < 18) return "Armando la respuesta…"
  if (segundos < 40) return "El caso pide una respuesta completa — unos segundos más…"
  return "Sigo en ello. Gracias por la paciencia…"
}

/** Tres puntos menta que laten en escalera. `aria-hidden`: el texto de al lado ya lo dice. */
function Puntos() {
  return (
    <span aria-hidden className="inline-flex items-end gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-[5px] rounded-full bg-brand animate-bounce motion-reduce:animate-none"
          style={{ animationDelay: `${i * 0.16}s`, animationDuration: "0.9s" }}
        />
      ))}
    </span>
  )
}

export function Pensando() {
  const [segundos, setSegundos] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const frase = fraseDeEspera(segundos)
  return (
    <span className="inline-flex items-center gap-2.5 text-[13px] text-fg-faint" aria-live="polite">
      <Puntos />
      {/* key={frase}: al cambiar la fase, el texto entra con un fundido corto — el propio cambio
          es la señal de que esto está vivo. */}
      <span key={frase} className="animate-in fade-in duration-500">
        {frase}
      </span>
    </span>
  )
}

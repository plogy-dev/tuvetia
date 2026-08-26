"use client"

// El campo de dinero para los formularios que se leen con `FormData`.
//
// ── POR QUÉ HAY DOS CAMPOS DE MONEDA Y NO UNO ──────────────────────────────────────────────────
//
// `InputMoneda` es controlado: recibe un número y devuelve un número. Sirve donde el formulario ya
// vive en estado de React — el onboarding, los drawers.
//
// Los formularios de facturación son otra cosa: son `<form action={…}>` con inputs SIN estado, y el
// servidor los lee por `name` desde el `FormData`. Meterles un campo controlado obligaría a
// reescribir cada uno para llevar su estado en React, que es una cirugía grande en el módulo más
// grande de la app y sin ninguna necesidad.
//
// ── CÓMO FUNCIONA ──────────────────────────────────────────────────────────────────────────────
//
// Son DOS inputs: el que se ve —texto, formateado, sin `name`, así que el `FormData` lo ignora— y
// uno oculto que lleva el `name` y el número pelado en pesos. El servidor sigue recibiendo
// exactamente lo mismo que antes; lo único que cambió es lo que la persona ve mientras escribe.
//
// `required` va en el VISIBLE y no en el oculto: el navegador no valida campos ocultos, así que
// ponerlo ahí dejaría pasar el formulario vacío y el error aparecería del lado del servidor, que es
// tarde y feo.

import { useState } from "react"

import { cn } from "@/lib/utils"
import { formatearMientrasEscribe, pesosDesdeTexto, textoDesdePesos } from "@/lib/moneda"

export function InputMonedaForm({
  name,
  defaultPesos,
  required,
  className,
  id,
  placeholder = "0",
  ...props
}: {
  /** El `name` que leerá el `FormData`. Va en el input oculto. */
  name: string
  defaultPesos?: number | null
  required?: boolean
  className?: string
  id?: string
  placeholder?: string
  "aria-label"?: string
}) {
  const [texto, setTexto] = useState(() => textoDesdePesos(defaultPesos))
  const pesos = pesosDesdeTexto(texto)

  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute top-1/2 left-3 z-1 -translate-y-1/2 text-[12px] font-medium text-fg-faint select-none"
        aria-hidden
      >
        COP
      </span>
      <input
        {...props}
        id={id}
        // `type="text"` y no `number`: el campo tiene que mostrar "50.000", y un `number` declara
        // inválido cualquier valor con puntos —según el navegador, lo vacía sin avisar—. El
        // `inputMode` conserva lo único que se quería de `number`: el teclado numérico en el móvil.
        type="text"
        inputMode="numeric"
        autoComplete="off"
        required={required}
        value={texto}
        onChange={(e) => setTexto(formatearMientrasEscribe(e.target.value))}
        placeholder={placeholder}
        className={cn(
          "mt-1 w-full rounded-lg border border-line bg-surface py-2 pr-3 pl-12 text-sm tabular-nums text-fg outline-none placeholder:text-fg-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      />
      <input type="hidden" name={name} value={pesos ?? ""} />
    </div>
  )
}

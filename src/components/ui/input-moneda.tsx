"use client"

// El campo para escribir plata. Uno solo, para toda la app.
//
// ── POR QUÉ UN COMPONENTE Y NO UN `type="number"` EN CADA FORMULARIO ───────────────────────────
//
// Porque eran nueve formularios con nueve campos de dinero, todos `<input type="number">` pelados,
// y ninguno decía en qué moneda ni en qué unidad estaba. El que lo dejó más claro fue el onboarding:
// una caja vacía pidiendo "el precio" de una consulta, sin `COP`, sin separador y sin nada que
// distinguiera cincuenta mil de quinientos mil salvo contar los ceros.
//
// ── LO QUE HACE ────────────────────────────────────────────────────────────────────────────────
//
//   · Muestra `COP` dentro del campo, a la izquierda. No como etiqueta suelta arriba: la etiqueta
//     se lee una vez y el campo se mira diez.
//   · Agrupa de a tres con punto MIENTRAS SE ESCRIBE. La lógica es pura y vive en `lib/moneda.ts`.
//   · Devuelve PESOS —el número que se guarda— y no el texto. Quien lo usa no ve el formato.
//
// ── `inputMode` Y NO `type="number"` ───────────────────────────────────────────────────────────
//
// El campo tiene que mostrar "50.000", y un `type="number"` no admite puntos: el navegador declara
// el valor inválido y, según cuál sea, lo vacía sin avisar. Con `type="text"` + `inputMode="numeric"`
// el teléfono sigue abriendo el teclado numérico, que es lo único que se quería de `number`.

import { forwardRef } from "react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { formatearMientrasEscribe, pesosDesdeTexto, textoDesdePesos } from "@/lib/moneda"

export const InputMoneda = forwardRef<
  HTMLInputElement,
  {
    /** El valor en PESOS. `null` = el campo está vacío, que no es lo mismo que cero. */
    value: number | null
    onValueChange: (pesos: number | null) => void
    id?: string
    name?: string
    placeholder?: string
    disabled?: boolean
    required?: boolean
    className?: string
    /** El rótulo `COP` dentro del campo. Se apaga en celdas de tabla, donde no cabe y donde
     *  la cabecera de la columna ya dice la moneda. */
    mostrarMoneda?: boolean
    "aria-label"?: string
  }
>(function InputMoneda(
  { value, onValueChange, className, placeholder = "0", mostrarMoneda = true, ...props },
  ref,
) {
  return (
    <div className="relative">
      {mostrarMoneda && (
        <span
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[12px] font-medium text-fg-faint select-none"
          aria-hidden
        >
          COP
        </span>
      )}
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        // El valor se re-deriva del número en cada render en vez de guardar el texto en un estado
        // aparte: con dos fuentes, una queda vieja el día que alguien setee el precio desde afuera
        // (sembrar el formulario, un reset) y el campo muestra una cosa mientras guarda otra.
        value={textoDesdePesos(value)}
        onChange={(e) => onValueChange(pesosDesdeTexto(formatearMientrasEscribe(e.target.value)))}
        placeholder={placeholder}
        // `pl-12` deja lugar al rótulo; `tabular-nums` hace que los dígitos no bailen al escribir, que
        // en un campo que se reformatea con cada tecla se nota mucho.
        className={cn("tabular-nums", mostrarMoneda && "pl-12", className)}
      />
    </div>
  )
})

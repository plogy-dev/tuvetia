"use client"

import * as React from "react"

// Un campo de plata que se lee como plata: 80000 se ve «80.000», en COP, mientras se teclea.
//
// ── POR QUÉ EXISTE (David, 26-ago) ────────────────────────────────────────────────────────────
//
// «al poner los precios de productos el predeterminado debe ser COP y debe estar en miles». El
// campo era un <input type="number">, y un number NO admite separadores: el admin tecleaba 800000
// y tenía que contar ceros con el dedo para saber si escribió ochenta mil u ochocientos mil — en
// el campo donde equivocarse por un cero es equivocarse por diez veces el precio.
//
// ── CÓMO FUNCIONA ─────────────────────────────────────────────────────────────────────────────
//
// Texto con inputMode="numeric" (teclado numérico en móvil). Se aceptan solo dígitos; el valor se
// re-pinta con puntos de miles es-CO en cada tecla. El FORMULARIO no se entera del cambio: un
// <input type="hidden"> lleva el número limpio bajo el `name` de siempre, así los handlers que
// leen FormData siguen intactos.
//
// SIN DECIMALES a propósito: los precios de venta en Colombia son pesos enteros (los centavos
// existen en la base por exactitud contable, no en el teclado de quien carga un catálogo).

const FMT = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 })

function soloDigitos(s: string): string {
  return s.replace(/\D/g, "")
}

export function InputPesos({
  name,
  defaultValue,
  required,
  className,
  "aria-label": ariaLabel,
  id,
}: {
  name: string
  /** En PESOS (no centavos), como venían usando los formularios. */
  defaultValue?: number
  required?: boolean
  className?: string
  "aria-label"?: string
  id?: string
}) {
  const [crudo, setCrudo] = React.useState(() =>
    defaultValue != null && !Number.isNaN(defaultValue) ? String(Math.round(defaultValue)) : "",
  )

  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        required={required}
        aria-label={ariaLabel}
        value={crudo ? FMT.format(Number(crudo)) : ""}
        onChange={(e) => setCrudo(soloDigitos(e.target.value))}
        placeholder="80.000"
        className={className}
      />
      {/* El número limpio para el FormData: los handlers existentes leen este name y no cambian. */}
      <input type="hidden" name={name} value={crudo} />
    </>
  )
}

import * as React from "react"

import { cn } from "@/lib/utils"

// La tarjeta de cifra del mockup: etiqueta en versalita, número grande en display con cifras de
// ancho fijo, y una pista debajo. Vivía sin exportar dentro de `dashboard/facturacion/page.tsx`,
// mientras otras pantallas se inventaban su propia versión.
//
// `tabular-nums` importa más de lo que parece: sin él, las cifras bailan de ancho al recalcularse
// y la fila entera tiembla.

export function StatCard({
  label,
  value,
  sub,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  /** Pista bajo la cifra: comparación, periodo, unidad. Opcional. */
  sub?: React.ReactNode
  className?: string
}) {
  return (
    // Forma del `.tv-stat` del mockup: radio de card (12px), padding 24, SIN SOMBRA —el sistema
    // sólo permite una, la de popovers— y la cifra en MONO, no en display. Que el número vaya en
    // mono no es capricho: es la misma regla que gobierna todo el sistema, donde la mono se reserva
    // para valores clínicos y montos, o sea para lo que se lee como dato y no como texto.
    <div className={cn("flex flex-col gap-2 rounded-xl border border-line bg-card p-6", className)}>
      <p className="text-[13px] font-medium text-fg-muted">{label}</p>
      <p className="font-mono text-[28px] font-medium leading-[1.1] tracking-[-0.02em] tabular-nums text-fg">
        {value}
      </p>
      {sub ? (
        <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">{sub}</p>
      ) : null}
    </div>
  )
}

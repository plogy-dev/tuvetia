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
    <div
      className={cn(
        "rounded-lg border border-line-soft bg-card px-[17px] pb-[13px] pt-[15px] shadow-sm",
        className,
      )}
    >
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </p>
      <p className="font-display text-[23px] font-semibold leading-[1.1] tracking-[-0.02em] tabular-nums text-fg">
        {value}
      </p>
      {sub ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">{sub}</p>
      ) : null}
    </div>
  )
}

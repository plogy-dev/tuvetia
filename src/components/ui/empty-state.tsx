import * as React from "react"

import { cn } from "@/lib/utils"

// Estado vacío con salida obligatoria.
//
// La auditoría encontró ocho versiones distintas de "no hay nada acá", y casi ninguna decía qué
// hacer a continuación: el drawer de nueva consulta llegaba a mencionar la sección "Pacientes" sin
// enlazarla. Un usuario nuevo entra a la app y TODAS sus pantallas están vacías — si ninguna
// ofrece el primer paso, la app parece rota en vez de nueva.
//
// Por eso `action` no es decorativo. Cuando no hay ninguna acción posible (por ejemplo, un filtro
// sin resultados: lo que toca es cambiar el filtro, no crear nada), se omite a propósito y el
// texto tiene que explicar por sí solo por qué está vacío.

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Botón o enlace que saca al usuario de acá. Ver la nota de arriba antes de omitirlo. */
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line-soft bg-card px-6 py-12 text-center shadow-sm",
        className,
      )}
    >
      {icon ? (
        <div
          className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-surface-2 text-fg-faint [&_svg]:size-5"
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <p className="font-display text-[15px] font-semibold text-fg">{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-fg-muted">
          {description}
        </p>
      ) : null}
      {action ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}

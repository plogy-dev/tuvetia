import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

// La pastilla de filtro, que estaba copiada con las mismas clases en Consultas (como <Link>, el
// filtro vive en la URL) y en Pacientes (como <button>, el filtro vive en useState). Las dos
// formas son legítimas y se conservan: lo que se unifica es el aspecto.
//
// `href` y `onClick` son excluyentes — con `href` sale un <Link>, con `onClick` un <button>. Sin
// "use client" a propósito: en una página de servidor sólo se usará la forma <Link>, y los
// componentes de cliente que lo importen se llevan el archivo a su bundle y pueden pasar `onClick`.

export function FilterChips({
  label,
  children,
  className,
}: {
  /** Prefijo tipo "Nota:" o "Especie:". Opcional: si el grupo se explica solo, sobra. */
  label?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {label ? (
        <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</span>
      ) : null}
      {children}
    </div>
  )
}

const CHIP_BASE =
  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
const CHIP_ON = "border-transparent bg-primary text-primary-foreground"
const CHIP_OFF = "border-line-soft bg-card text-fg-muted hover:bg-surface-2 hover:text-fg"

type FilterChipProps = {
  active?: boolean
  children: React.ReactNode
  className?: string
} & (
  | { href: string; onClick?: never }
  | { href?: never; onClick: () => void }
)

export function FilterChip({ active, children, className, ...props }: FilterChipProps) {
  const classes = cn(CHIP_BASE, active ? CHIP_ON : CHIP_OFF, className)

  if (props.href !== undefined) {
    return (
      <Link href={props.href} aria-current={active ? "true" : undefined} className={classes}>
        {children}
      </Link>
    )
  }

  return (
    <button type="button" onClick={props.onClick} aria-pressed={active} className={classes}>
      {children}
    </button>
  )
}

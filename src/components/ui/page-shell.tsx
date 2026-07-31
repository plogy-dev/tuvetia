import * as React from "react"

import { cn } from "@/lib/utils"

// El marco de página que las 16 rutas de facturación ya repetían casi idéntico: <main> que ocupa
// el resto del ancho, un contenedor centrado con respiración fija, y una cabecera con título en
// display, subtítulo y un grupo de acciones a la derecha.
//
// Se extrae de `dashboard/facturacion/page.tsx`, que es la traducción del mockup del cliente. No
// es un estilo nuevo: es el que ya estaba, dejando de copiarse a mano.
//
// Sin "use client": así lo pueden usar tanto las páginas de servidor (la mayoría) como los
// componentes de cliente que lo importen.

export function PageShell({
  children,
  width = "wide",
  className,
}: {
  children: React.ReactNode
  /** `wide` para listados y tableros; `narrow` para formularios y pantallas de una sola columna. */
  width?: "wide" | "narrow"
  className?: string
}) {
  return (
    <main className="min-w-0 flex-1">
      <div
        className={cn(
          "mx-auto w-full px-[30px] pb-16 pt-7",
          width === "wide" ? "max-w-[1200px]" : "max-w-3xl",
          className,
        )}
      >
        {children}
      </div>
    </main>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** Botones o enlaces alineados a la derecha. Se envuelven solos en pantallas estrechas. */
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn("mb-[22px] flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.022em] text-fg">
          {title}
        </h1>
        {description ? <p className="mt-[3px] text-[13px] text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

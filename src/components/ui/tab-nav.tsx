import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

// Las pestañas subrayadas del cliente, en su forma de NAVEGACIÓN: cada pestaña es una URL y el
// servidor decide qué pintar. Extraído del Catálogo de facturación, que ya las tenía.
//
// OJO — no confundir con `ui/tabs.tsx`: aquel es el componente de base-ui, con estado en el
// cliente, para alternar paneles ya cargados sin recargar la página (variante `line`, mismo
// aspecto). La regla es simple: si la pestaña merece su propia URL —porque se comparte, se marca
// o se vuelve con el botón atrás— va acá; si es sólo mostrar/ocultar, va en `ui/tabs.tsx`.

export function TabNav({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <nav className={cn("mb-5 flex gap-1 overflow-x-auto border-b border-line", className)}>
      {children}
    </nav>
  )
}

export function TabNavLink({
  href,
  active,
  children,
  className,
}: {
  href: string
  active?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors",
        active
          ? "border-brand font-medium text-fg"
          : "border-transparent text-fg-muted hover:text-fg",
        className,
      )}
    >
      {children}
    </Link>
  )
}

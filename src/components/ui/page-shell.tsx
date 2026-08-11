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
      {/* Padding y separación del mockup: `clamp(16px,3vw,32px)` en los cuatro lados y `gap` de 24
          entre bloques, en vez de `px-[30px] pt-7 pb-16`. El `flex-col gap` es lo que evita que
          cada página invente su propia separación entre el encabezado y el contenido. */}
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-6 p-[clamp(16px,3vw,32px)]",
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
    // Proporciones del `SectionHeading` del mockup v2: 28px, peso 500, tracking -0.01em y la
    // descripción a 15px. Antes era 26px en semibold con -0.022em, que estaba calibrado para
    // Bricolage —un grotesco—. Newsreader es un serif: apretado y en negrita se empasta, y la
    // descripción a 13px quedaba como pie de foto en vez de como la línea de contexto que el
    // mockup usa para poner datos del día ("Miércoles 5 de agosto · 9 citas · 1 espacio libre").
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-medium leading-[1.2] tracking-[-0.01em] text-fg">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-[60ch] text-[15px] text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/**
 * Un listado con la forma del mockup: UN contenedor con borde, y filas separadas por una línea.
 *
 * Es la diferencia de composición más visible entre lo que teníamos y lo que el cliente dibujó.
 * Nosotros poníamos una card con sombra por sección —a veces una por ítem—; el mockup no tiene
 * ninguna sombra fuera de los popovers, y sus listas son un solo bloque. Con veinte filas, veinte
 * cards son veinte rectángulos flotando; un bloque con líneas es una tabla que se lee de un vistazo.
 */
export function ListaEnBloque({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-line [&>*+*]:border-t [&>*]:border-line",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** El encabezado de columnas: versalitas 11px, como en todo el sistema. */
export function FilaEncabezado({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 px-5 py-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Una fila de datos. El padding 16/20 es el del mockup. */
export function Fila({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-4 px-5 py-4", className)}>{children}</div>
}

"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// ── LOS AVISOS VAN ARRIBA A LA DERECHA, Y ES UN ARREGLO, NO UN GUSTO ─────────────────────────
//
// Sonner por defecto los pone abajo a la derecha: 356 px de ancho, `z-index: 999999999` y SIN
// `pointer-events: none` en el contenedor. Ahí abajo vive la burbuja de VetGPT (`athos-dock.tsx`,
// `bottom-4 right-4`, 48 px). O sea que durante los 4 segundos de cada aviso —y son varios
// seguidos al acabar una consulta— el aviso quedaba literalmente encima de la burbuja y los clics
// no le llegaban.
//
// Es lo que David reportó el 26-ago probando el Modo Fantasma: «uno deja de grabar y sale una
// vaina abajo a la derecha que confunde al usuario y como que traba el app». No era una impresión:
// el app estaba trabado en esa esquina.
//
// Arriba a la derecha está libre. El notch de la consulta va arriba AL CENTRO
// (`notch-de-consulta.tsx`) y la barra inferior del móvil ocupa abajo, así que las otras dos
// posiciones obvias también estaban tomadas.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-right"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

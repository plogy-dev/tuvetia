"use client"

// La campanita de notificaciones de la cabecera (David, 26-ago: «hacer una campanita arriba …
// de notificaciones»).
//
// Cuenta LO MISMO que la insignia del sidebar —los mensajes entrantes sin leer— y por el mismo
// hook, así que las dos señales nunca se contradicen: si la campanita dice 3, el ítem de
// Comunicaciones dice 3. El clic lleva a la bandeja, que es donde se resuelven.
//
// Vive en la cabecera y no en la barra lateral porque la barra colapsada (48px) ya degrada su
// insignia a un punto: la cabecera está siempre a la vista, colapsado lo que esté.

import Link from "next/link"
import { BellIcon } from "lucide-react"

import { useMensajesSinLeer } from "@/components/comunicaciones/insignia-sin-leer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function Campanita({ className }: { className?: string }) {
  const sinLeer = useMensajesSinLeer()
  const rotulo =
    sinLeer > 0
      ? `Notificaciones: ${sinLeer} mensaje${sinLeer === 1 ? "" : "s"} sin leer`
      : "Notificaciones"
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("relative", className)}
      title={rotulo}
      render={<Link href="/dashboard/comunicaciones" />}
    >
      <BellIcon />
      {sinLeer > 0 && (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[9px] font-bold leading-none text-on-brand"
        >
          {sinLeer > 9 ? "9+" : sinLeer}
        </span>
      )}
      <span className="sr-only">{rotulo}</span>
    </Button>
  )
}

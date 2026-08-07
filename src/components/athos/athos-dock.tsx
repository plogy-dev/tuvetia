"use client"

// El contenedor fijo donde vive Athos en todas las pantallas.
//
// UN SOLO ELEMENTO `fixed`, no varios: la burbuja y —más adelante— la pastilla de grabación se
// apilan dentro de este contenedor. Dos elementos fijos independientes terminan solapándose en
// alguna pantalla o en algún ancho, y ese bug aparece tarde.
//
// z-40, DEBAJO de los modales. El mapa del repo es: sidebar en z-10, Drawer/Sheet/Toaster en z-50.
// Que un drawer modal tape a Athos es lo correcto — durante un flujo modal el vet no debería poder
// tocarlo. Y por encima de z-10 para que el sidebar no lo tape a él.
//
// `pointer-events-none` en el contenedor y `pointer-events-auto` en cada hijo: la zona vacía del
// dock no puede robar clicks del contenido de abajo. Es también el seguro contra el tour de
// onboarding, que resalta elementos del sidebar.
//
// NO se portalea a `<body>`. Verificado: `SidebarProvider` renderiza un div sin `transform`,
// `filter` ni `will-change` (`ui/sidebar.tsx`), así que no crea containing block y un hijo `fixed`
// se posiciona contra el viewport igual. Portalear traería el problema de tokens de color que
// `app-sidebar.tsx` ya documenta para el sidebar móvil, sin ninguna ganancia.

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { toast } from "sonner"

import { AthosWidget } from "@/components/athos/athos-widget"
import { GrabacionPastilla } from "@/components/athos/grabacion-pastilla"
import { migajaDeGrabacionPerdida } from "@/lib/consulta-viva/sesion"

export function AthosDock() {
  const pathname = usePathname()

  // Si la pestaña se recargó con una grabación viva, el audio de ese tramo se perdió y no hay forma
  // de recuperarlo. Esto no lo arregla: lo DECLARA. Una pérdida dicha es infinitamente mejor que una
  // silenciosa, que es lo que había hasta ahora.
  useEffect(() => {
    const migaja = migajaDeGrabacionPerdida()
    if (!migaja) return
    const quien = migaja.pacienteNombre ? ` de ${migaja.pacienteNombre}` : ""
    toast.warning(`La grabación de la consulta${quien} se interrumpió al recargar la página.`, {
      description: "Ese tramo de audio no se guardó.",
      duration: 12_000,
    })
  }, [])

  // La pastilla se ve en TODAS las pantallas, incluida `/dashboard/asistente`. La burbuja no: ahí
  // la pantalla ES Athos, y una burbuja encima sería un segundo Athos con otro hilo.
  const ocultarBurbuja = pathname.startsWith("/dashboard/asistente")

  return (
    <div
      role="region"
      aria-label="Athos"
      className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] right-3 z-40 flex flex-col items-end gap-2 sm:bottom-4 sm:right-4"
    >
      <GrabacionPastilla />
      {!ocultarBurbuja && <AthosWidget />}
    </div>
  )
}

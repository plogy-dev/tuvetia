"use client"

// El contenedor fijo donde vive la burbuja de Athos en todas las pantallas.
//
// z-40, DEBAJO de los modales. El mapa del repo es: sidebar en z-10, Drawer/Sheet/Toaster en z-50.
// Que un drawer modal tape a Athos es lo correcto — durante un flujo modal el vet no debería poder
// tocarlo. Y por encima de z-10 para que el sidebar no lo tape a él.
//
// `pointer-events-none` en el contenedor y `pointer-events-auto` en el hijo: la zona vacía del dock
// no puede robar clicks del contenido de abajo. Es también el seguro contra el tour de onboarding,
// que resalta elementos del sidebar.
//
// NO se portalea a `<body>`. Verificado: `SidebarProvider` renderiza un div sin `transform`,
// `filter` ni `will-change` (`ui/sidebar.tsx`), así que no crea containing block y un hijo `fixed`
// se posiciona contra el viewport igual. Portalear traería el problema de tokens de color que
// `app-sidebar.tsx` ya documenta para el sidebar móvil, sin ninguna ganancia.
//
// EL NOTCH DE LA CONSULTA YA NO VIVE ACÁ. Se mudó a `notch-de-consulta.tsx`, montado dentro del
// `SidebarInset`: va arriba y al centro DEL CONTENIDO, y este contenedor está anclado abajo a la
// derecha. Un hijo peleándole la posición al padre es lo que se rompe en el primer ancho que nadie
// probó — y además son dos cosas distintas: acá Athos espera a que lo llamen, allá hay una consulta
// pasando.

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { toast } from "sonner"

import { AthosWidget } from "@/components/athos/athos-widget"
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

  // La burbuja no se ve en `/dashboard/asistente`: ahí la pantalla ES Athos, y una burbuja encima
  // sería un segundo Athos con otro hilo.
  if (pathname.startsWith("/dashboard/asistente")) return null

  return (
    <div
      role="region"
      aria-label="Athos"
      // En móvil sube por encima del tab bar (`tab-bar-movil.tsx`): sin este despeje la burbuja
      // quedaba DEBAJO de la barra, o sea invisible y sin poder tocarse. El `5rem` cubre la altura
      // de la barra (48px de ítem + padding) más el área segura del sistema.
      //
      // El corte es `md:` y NO `sm:` porque el tab bar es `md:hidden` y `useIsMobile` usa 768px. Con
      // `sm:` había una franja de 640 a 767px donde la barra seguía visible y el dock ya había vuelto
      // abajo — o sea solapados, en el único rango de anchos que nadie prueba.
      className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-3 z-40 flex flex-col items-end gap-2 md:bottom-4 md:right-4"
    >
      <AthosWidget />
    </div>
  )
}

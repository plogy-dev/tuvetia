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

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { toast } from "sonner"

import { AthosWidget } from "@/components/athos/athos-widget"
import { GrabacionPastilla } from "@/components/athos/grabacion-pastilla"
import { PanelModoFantasma } from "@/components/athos/panel-modo-fantasma"
import { migajaDeGrabacionPerdida } from "@/lib/consulta-viva/sesion"
import { useConsultaViva } from "@/lib/consulta-viva/usar"

export function AthosDock() {
  const pathname = usePathname()
  const estado = useConsultaViva()
  // Abierto/cerrado del panel del Modo Fantasma. Vive acá y no en el módulo de la sesión a propósito:
  // que el panel esté visible es una preferencia de ESTA pestaña y de este momento, no parte del
  // estado de la grabación. Meterlo en `consultaViva` lo convertiría en algo que sobrevive la
  // navegación, y entonces el panel reaparecería solo al cambiar de pantalla.
  const [panelAbierto, setPanelAbierto] = useState(false)

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
  const ocultarBurbuja = pathname.startsWith("/dashboard/asistente")

  // Y LA MISMA REGLA PARA LA GRABACIÓN. Estando en la pantalla de la consulta que se está grabando,
  // la pastilla y el panel sobran: esa pantalla ya tiene el grabador con su cronómetro, su
  // transcripción en vivo y su botón de detener.
  //
  // Sin esto había TRES superficies de grabación simultáneas —el bloque de la pantalla, la pastilla
  // y el panel encima— cada una con su propio botón de detener. Es parte de lo que el cliente
  // llamó "mucha fricción" en el Modo Fantasma.
  //
  // La pastilla existe para cuando el vet SE FUE a otra parte con el micrófono abierto, que es su
  // único trabajo. Acá no se fue a ningún lado.
  const enSuPropiaConsulta = Boolean(
    estado.consultaId && pathname === `/dashboard/consultas/${estado.consultaId}`,
  )

  return (
    <>
      {/* LA CONSULTA EN CURSO VA ARRIBA AL CENTRO, la burbuja abajo a la derecha. Son dos cosas
          distintas y por eso son dos contenedores: una es estado del sistema, la otra es donde
          Athos espera a que lo llamen. */}
      {!enSuPropiaConsulta && (
        <NotchDeLaConsulta
          abierto={panelAbierto}
          alAlternar={() => setPanelAbierto((v) => !v)}
          alCerrar={() => setPanelAbierto(false)}
        />
      )}

      <div
        role="region"
        aria-label="Athos"
        // En móvil sube por encima del tab bar (`tab-bar-movil.tsx`): sin este despeje la burbuja de
        // Athos quedaba DEBAJO de la barra, o sea invisible y sin poder tocarse. El `5rem` cubre la
        // altura de la barra (48px de ítem + padding) más el área segura del sistema.
        //
        // El corte es `md:` y NO `sm:` porque el tab bar es `md:hidden` y `useIsMobile` usa 768px.
        // Con `sm:` había una franja de 640 a 767px donde la barra seguía visible y el dock ya había
        // vuelto abajo — o sea solapados, en el único rango de anchos que nadie prueba.
        className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-3 z-40 flex flex-col items-end gap-2 md:bottom-4 md:right-4"
      >
        {!ocultarBurbuja && <AthosWidget />}
      </div>
    </>
  )
}

/**
 * El notch de la consulta, ARRIBA Y AL CENTRO.
 *
 * SE SEPARÓ DEL DOCK, y no por orden. El dock es un `fixed` anclado abajo a la derecha con
 * `flex-col items-end`: para poner el notch arriba al centro había que anularle la posición al hijo,
 * y un hijo que pelea con el layout de su padre es el tipo de cosa que se rompe en el primer ancho
 * que nadie probó.
 *
 * Además son dos cosas distintas. El dock es donde Athos ESPERA a que lo llamen; esto es una consulta
 * EN CURSO, que es estado del sistema y va donde el sistema pone lo que está pasando.
 *
 * z-40, igual que el dock: por encima del sidebar (z-10) y por debajo de los modales (z-50). Que un
 * drawer tape la consulta es correcto — durante un flujo modal el vet no debería poder tocarla.
 */
function NotchDeLaConsulta({
  abierto,
  alAlternar,
  alCerrar,
}: {
  abierto: boolean
  alAlternar: () => void
  alCerrar: () => void
}) {
  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-40 flex -translate-x-1/2 flex-col items-center">
      <GrabacionPastilla abierto={abierto} alAlternar={alAlternar} />
      <PanelModoFantasma abierto={abierto} alCerrar={alCerrar} />
    </div>
  )
}

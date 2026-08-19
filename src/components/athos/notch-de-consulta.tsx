"use client"

// El notch de la consulta en curso: la pastilla y el panel que cuelga de ella.
//
// POR QUÉ NO VIVE EN EL DOCK. El dock es un `fixed` anclado abajo a la derecha con
// `flex-col items-end`, y el notch va arriba y al centro: un hijo que le pelea la posición a su
// padre es el tipo de cosa que se rompe en el primer ancho que nadie probó. Además son dos cosas
// distintas — el dock es donde Athos ESPERA a que lo llamen; esto es una consulta EN CURSO, que es
// estado del sistema.
//
// ── DÓNDE SE MONTA, Y POR QUÉ IMPORTA ───────────────────────────────────────────────────────────
//
// Va DENTRO de `SidebarInset` (`dashboard/layout.tsx`), que es `relative`. Con eso se resuelven dos
// problemas de posición que un `fixed` sobre el viewport no puede:
//
//   1. **Se centra sobre el CONTENIDO, no sobre la pantalla.** Con el sidebar abierto (288px), el
//      centro del viewport queda 144px a la izquierda del centro del área de trabajo. Centrado
//      sobre el viewport, el notch se veía corrido — y peor: se movía al plegar el sidebar.
//   2. **Queda DEBAJO de la cabecera.** Arriba del todo tapaba el título de la pantalla y competía
//      con el buscador global, que es lo último que uno quiere cubrir con algo que está siempre.
//
// El prototipo lo pone en `top-3` sobre el viewport porque su cabecera es otra. Se toma la IDEA
// —arriba, al centro, flotando sobre el contenido— y se resuelve contra el layout que tenemos.

import { useState } from "react"
import { usePathname } from "next/navigation"

import { GrabacionPastilla } from "@/components/athos/grabacion-pastilla"
import { PanelModoFantasma } from "@/components/athos/panel-modo-fantasma"
import { useConsultaViva } from "@/lib/consulta-viva/usar"
import { useVivo } from "@/lib/consulta-viva/proveedor"

export function NotchDeConsulta() {
  const pathname = usePathname()
  const estado = useConsultaViva()

  // Abierto/cerrado del panel. Vive acá y no en el módulo de la sesión a propósito: que el panel
  // esté desplegado es una preferencia de ESTA pestaña y de este momento, no parte del estado de la
  // grabación. Meterlo en `consultaViva` lo haría sobrevivir la navegación, y entonces el panel
  // reaparecería solo al cambiar de pantalla.
  const [abierto, setAbierto] = useState(false)

  // EL ESTADO VIENE DEL PROVEEDOR, que vive en el layout. No se crea acá por dos razones: el panel
  // se desmonta al contraerse —y con él se perdían las notas, que es justo lo que tiene que
  // sobrevivir a minimizar— y porque el cockpit muestra lo mismo desde otra rama del árbol. Dos
  // ganchos serían dos relojes disparando contra el mismo presupuesto.
  const vivo = useVivo()

  // EN LA PANTALLA DE SU PROPIA CONSULTA NO SE PINTA. Esa pantalla ya tiene el grabador con su
  // cronómetro, su transcripción en vivo y su botón de detener; sin esto había TRES superficies de
  // grabación simultáneas, cada una con su propio botón. Es parte de lo que el cliente llamó "mucha
  // fricción". El notch existe para cuando el vet SE FUE a otra parte con el micrófono abierto.
  const enSuPropiaConsulta = Boolean(
    estado.consultaId && pathname === `/dashboard/consultas/${estado.consultaId}`,
  )
  if (enSuPropiaConsulta) return null

  return (
    <div
      // `absolute` dentro del `SidebarInset` (que es `relative`), no `fixed`: así hereda el ancho
      // del área de contenido y se centra sobre ella sola, con el sidebar abierto o plegado.
      //
      // `pointer-events-none` en el contenedor y `auto` en los hijos: la franja vacía a los lados
      // del notch no puede robarle clicks al contenido de abajo.
      className="pointer-events-none absolute left-1/2 top-[calc(var(--header-height)+0.5rem)] z-40 flex -translate-x-1/2 flex-col items-center"
    >
      <GrabacionPastilla
        abierto={abierto}
        alerta={vivo.alerta}
        alAlternar={() => setAbierto((v) => !v)}
      />
      <PanelModoFantasma vivo={vivo} abierto={abierto} alCerrar={() => setAbierto(false)} />
    </div>
  )
}

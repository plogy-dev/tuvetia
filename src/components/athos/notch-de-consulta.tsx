"use client"

// El notch de la consulta en curso: la pastilla y el panel que cuelga de ella.
//
// POR QUÉ NO VIVE EN EL DOCK. El dock es un `fixed` anclado abajo a la derecha con
// `flex-col items-end`, y el notch va arriba y al centro: un hijo que le pelea la posición a su
// padre es el tipo de cosa que se rompe en el primer ancho que nadie probó. Además son dos cosas
// distintas — el dock es donde VetGPT ESPERA a que lo llamen; esto es una consulta EN CURSO, que es
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
//
// ── Y SE PUEDE CORRER ───────────────────────────────────────────────────────────────────────────
//
// Lo pidió Luciano el 21-ago: *"que sea movible"*. Centrado arriba es el mejor lugar por defecto,
// no el mejor lugar siempre: tapa el título de la pantalla, la primera fila de una tabla o el
// encabezado de la agenda, según dónde esté el vet. Con la grabación sobreviviendo la navegación,
// es un objeto permanente encima de todo — y algo permanente que estorba tiene que poder correrse.
//
// EL DESPLAZAMIENTO SE ACOTA AL ÁREA DE CONTENIDO, y se vuelve a acotar cuando cambia el tamaño de
// la ventana. Sin eso, una posición guardada en pantalla ancha deja el notch fuera de una angosta:
// invisible, sin forma de recuperarlo, y sin nada que avise de que el micrófono sigue abierto.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"

import { GrabacionPastilla } from "@/components/athos/grabacion-pastilla"
import { PanelModoFantasma } from "@/components/athos/panel-modo-fantasma"
import {
  acotar,
  centradoEnElServidor,
  escribirDesplazamiento,
  estaCentrado,
  leerDelAlmacen,
  suscribirAlDesplazamiento,
  type Desplazamiento,
  type Limites,
} from "@/lib/athos/notch-movido"
import { useConsultaViva } from "@/lib/consulta-viva/usar"
import { useVivo } from "@/lib/consulta-viva/proveedor"

/** Sin medir todavía no se deja correr a ningún lado: acotar contra 0 mantiene el notch centrado. */
const SIN_MEDIR: Limites = { x: 0, y: 0 }

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

  const guardado = useSyncExternalStore(
    suscribirAlDesplazamiento,
    leerDelAlmacen,
    centradoEnElServidor,
  )

  const cajaRef = useRef<HTMLDivElement | null>(null)
  const [limites, setLimites] = useState<Limites>(SIN_MEDIR)

  // CUÁNTO SE PUEDE CORRER, medido contra el área de contenido (el `offsetParent`, que es el
  // `SidebarInset`). Se recalcula al cambiar el tamaño de la ventana Y al plegar el sidebar — los
  // dos cambian el ancho disponible, y el segundo no dispara `resize`, por eso va un
  // `ResizeObserver` sobre el padre y no un listener de ventana.
  const medir = useCallback(() => {
    const el = cajaRef.current
    const padre = el?.offsetParent as HTMLElement | null
    if (!el || !padre) return
    // El horizontal es simétrico porque el origen es el CENTRO: la mitad del sobrante para cada
    // lado. El vertical arranca donde ya está —debajo de la cabecera— y sólo baja.
    setLimites({
      x: Math.max(0, (padre.clientWidth - el.offsetWidth) / 2),
      y: Math.max(0, padre.clientHeight - el.offsetTop - el.offsetHeight),
    })
  }, [])

  useLayoutEffect(() => {
    medir()
    const padre = cajaRef.current?.offsetParent
    if (!padre || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(medir)
    ro.observe(padre)
    return () => ro.disconnect()
  }, [medir, abierto, estado.fase])

  // RESCATE. Si lo guardado quedó fuera de lo que hoy cabe —otra pantalla, sidebar desplegado,
  // ventana más chica— se corrige en el almacén y no sólo al pintar. Corregir sólo la pintura
  // dejaría el valor malo guardado, esperando a la próxima ventana donde vuelva a romper.
  useEffect(() => {
    if (limites === SIN_MEDIR) return
    const dentro = acotar(guardado, limites)
    if (dentro.x !== guardado.x || dentro.y !== guardado.y) escribirDesplazamiento(dentro)
  }, [guardado, limites])

  const sensores = useSensors(
    // El mismo umbral que el tablero (#149): 6px separan un arrastre de un click, y sin él tocar
    // la pastilla para desplegarla la movería un pixel.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const alSoltar = useCallback(
    (e: DragEndEvent) => {
      escribirDesplazamiento(
        acotar({ x: guardado.x + e.delta.x, y: guardado.y + e.delta.y }, limites),
      )
    },
    [guardado, limites],
  )

  // EN LA PANTALLA DE SU PROPIA CONSULTA NO SE PINTA. Esa pantalla ya tiene el grabador con su
  // cronómetro, su transcripción en vivo y su botón de detener; sin esto había TRES superficies de
  // grabación simultáneas, cada una con su propio botón. Es parte de lo que el cliente llamó "mucha
  // fricción". El notch existe para cuando el vet SE FUE a otra parte con el micrófono abierto.
  const enSuPropiaConsulta = Boolean(
    estado.consultaId && pathname === `/dashboard/consultas/${estado.consultaId}`,
  )

  // CERRAR TOCANDO AFUERA, SIN VELO. El panel tenía un `fixed inset-0 bg-black/20` que atenuaba
  // la pantalla entera y se comía todos los clics — el «contorno gris» que el cliente señaló dos
  // veces el 26-ago. Un listener de documento hace lo mismo sin pintar ni bloquear nada: el
  // PRIMER clic afuera cierra Y llega a su destino — cerrar el panel no debe costarle al vet el
  // clic que estaba dando. `pointerdown` y no `click` para ganarle a cualquier stopPropagation.
  useEffect(() => {
    if (!abierto) return
    const alTocarAfuera = (e: PointerEvent) => {
      const caja = cajaRef.current
      if (caja && !caja.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener("pointerdown", alTocarAfuera)
    return () => document.removeEventListener("pointerdown", alTocarAfuera)
  }, [abierto])

  if (enSuPropiaConsulta) return null

  return (
    <DndContext sensors={sensores} onDragEnd={alSoltar}>
      <Arrastrable
        cajaRef={cajaRef}
        guardado={guardado}
        limites={limites}
        abierto={abierto}
        alerta={vivo.alerta}
        alAlternar={() => setAbierto((v) => !v)}
        alCentrar={() => escribirDesplazamiento({ x: 0, y: 0 })}
      >
        <PanelModoFantasma vivo={vivo} abierto={abierto} alCerrar={() => setAbierto(false)} />
      </Arrastrable>
    </DndContext>
  )
}

/**
 * El bloque que se mueve: la pastilla y el panel, juntos.
 *
 * SE MUEVEN LOS DOS O NINGUNO. El panel cuelga de la pastilla y leen como una sola pieza —la
 * pastilla pierde el redondeo de abajo cuando está abierto—; moverlos por separado los partiría al
 * medio. Por eso el arrastre vive en el contenedor y no en la pastilla.
 */
function Arrastrable({
  cajaRef,
  guardado,
  limites,
  abierto,
  alerta,
  alAlternar,
  alCentrar,
  children,
}: {
  cajaRef: React.RefObject<HTMLDivElement | null>
  guardado: Desplazamiento
  limites: Limites
  abierto: boolean
  alerta: boolean
  alAlternar: () => void
  alCentrar: () => void
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: "notch-de-consulta",
  })

  // Lo guardado MÁS lo que se lleva arrastrado ahora mismo, acotado en vivo. Acotar sólo al soltar
  // dejaría al notch salirse del área mientras se arrastra y volver de un salto al soltarlo, que se
  // lee como que la app corrigió un error del usuario en vez de como un límite.
  const d = acotar(
    { x: guardado.x + (transform?.x ?? 0), y: guardado.y + (transform?.y ?? 0) },
    limites,
  )

  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        cajaRef.current = el
      }}
      // `absolute` dentro del `SidebarInset` (que es `relative`), no `fixed`: así hereda el ancho
      // del área de contenido y se centra sobre ella sola, con el sidebar abierto o plegado.
      //
      // `pointer-events-none` en el contenedor y `auto` en los hijos: la franja vacía a los lados
      // del notch no puede robarle clicks al contenido de abajo.
      className="pointer-events-none absolute left-1/2 top-[calc(var(--header-height)+0.5rem)] z-40 flex flex-col items-center"
      // El `-50%` es el centrado y el resto es el desplazamiento: van en el MISMO transform porque
      // `-translate-x-1/2` de Tailwind y un transform en línea se pisan entre sí.
      style={{
        transform: `translate(calc(-50% + ${d.x}px), ${d.y}px)`,
        // Mientras se arrastra no hay transición: el notch tiene que ir pegado al puntero. Al
        // soltar y al volver al centro, sí — un salto instantáneo no se lee como movimiento.
        transition: isDragging ? "none" : "transform 120ms ease-out",
      }}
    >
      <GrabacionPastilla
        abierto={abierto}
        alerta={alerta}
        alAlternar={alAlternar}
        asa={{ ...attributes, ...listeners }}
        arrastrando={isDragging}
        alCentrar={estaCentrado(guardado) ? undefined : alCentrar}
      />
      {children}
    </div>
  )
}

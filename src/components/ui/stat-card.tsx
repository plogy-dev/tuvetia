import * as React from "react"
import { ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/utils"

// La tarjeta de cifra del mockup: etiqueta en versalita, número grande en display con cifras de
// ancho fijo, y una pista debajo. Vivía sin exportar dentro de `dashboard/facturacion/page.tsx`,
// mientras otras pantallas se inventaban su propia versión.
//
// `tabular-nums` importa más de lo que parece: sin él, las cifras bailan de ancho al recalcularse
// y la fila entera tiembla.

export function StatCard({
  label,
  value,
  sub,
  icono,
  tono,
  onVer,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  /** Pista bajo la cifra: comparación, periodo, unidad. Opcional. */
  sub?: React.ReactNode
  /** Icono de identidad de la cifra. Con `tono`, se pinta como chip de color arriba a la
   *  derecha — el toque OkVet que David pidió (26-ago: «darle más vida»). Opcional: las
   *  pantallas que no lo pasan se ven exactamente como antes. */
  icono?: React.ReactNode
  /** El color del chip, como token de la paleta categórica (`var(--chart-N)`). El COLOR VIVE EN
   *  EL CHIP, NUNCA EN LA LETRA: número y rótulo siguen en tinta — es la regla de todo el
   *  sistema de datos, y lo que mantiene la fila legible con daltonismo o impresa en gris. */
  tono?: string
  /**
   * Qué hacer al tocar la cifra. Con `onVer` la tarjeta pasa a ser un BOTÓN y muestra la flecha.
   *
   * EL CLIENTE LO PIDIÓ TRES VECES, y la tercera precisó la forma. El 17-ago: «hacer que los
   * widgets de estadísticas sean interactivos — hacer clic en "Citas de hoy" para ver la lista».
   * El 18-ago: «las pastillas de datos en todos los módulos deben ser interactivas, permitiendo
   * profundizar en los datos». Y el 19-ago, cuando quedó claro que lo obvio era navegar:
   *
   *     Luciano: "no que te full redireccione, sino que simplemente sea como una vista más
   *               directa… como una sub página, como que sea la misma página pero una vista
   *               más directa"
   *     Felipe:  "como un mini previo"
   *
   * Y tiene razón, por el tablero mismo: la pregunta que dispara una cifra —"¿cuáles son esas 9
   * citas?"— dura dos segundos, y navegar cuesta perder de vista todo lo demás que se estaba
   * mirando, que es justamente para lo que existe un tablero. Por eso `onVer` es un callback y no
   * un `href`: la tarjeta abre una vista rápida encima, y el enlace a la sección baja al pie de
   * ella (ver `dashboard/vista-de-la-pastilla.tsx`).
   *
   * SIN `onVer` LA TARJETA SE QUEDA COMO ESTABA. Hay métricas que no tienen detalle que mostrar, y
   * fingir que sí —cursor de mano, hover que reacciona— es una promesa que no se cumple al tocar.
   */
  onVer?: () => void
  className?: string
}) {
  // `button` o `div` según haya detalle que ver. El `as` es porque las dos firmas no coinciden y
  // TypeScript no puede unificarlas sin ayuda.
  const Contenedor = (onVer ? "button" : "div") as React.ElementType

  return (
    // Forma del `.tv-stat` del mockup: radio de card (12px), padding 24, SIN SOMBRA —el sistema
    // sólo permite una, la de popovers— y la cifra en MONO, no en display. Que el número vaya en
    // mono no es capricho: es la misma regla que gobierna todo el sistema, donde la mono se reserva
    // para valores clínicos y montos, o sea para lo que se lee como dato y no como texto.
    // SIN BORDE Y SOBRE LA SUPERFICIE ELEVADA, no una card más.
    //
    // EL PROBLEMA QUE RESUELVE. En el tablero había SEIS cajas con exactamente el mismo
    // `rounded-xl border bg-card`: las cuatro métricas, el gráfico y la lista de citas. Sin
    // jerarquía, la pantalla se lee como una grilla de ladrillos y nada dice qué mirar primero —
    // que es la mitad de lo que el cliente describió como "no me gusta cómo está organizada".
    //
    // Una métrica NO es un panel: es un dato suelto. Los paneles (el gráfico, la lista) llevan
    // borde porque contienen cosas; una métrica es una cifra con su rótulo, y encerrarla en el
    // mismo marco la pone al mismo nivel de algo que tiene diez filas adentro.
    //
    // Queda un solo nivel de contraste —relleno suave contra el fondo— y con eso las cuatro
    // métricas leen como una FILA de datos, no como cuatro tarjetas compitiendo con los paneles.
    //
    // EL RADIO Y EL PADDING NO SE TOCAN: los 12px de card y el padding 24 salen del mockup de David
    // y siguen valiendo. Lo que cambia es el MARCO, que es donde estaba el problema.
    <Contenedor
      {...(onVer ? { type: "button", onClick: onVer } : {})}
      className={cn(
        "group relative flex flex-col gap-2 rounded-xl bg-surface-2 p-6 text-left",
        onVer &&
          "transition-colors hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {/* El chip va ABSOLUTO en la esquina para no empujar el número: la tarjeta sigue midiendo lo
          mismo con chip o sin él, y la fila no baila cuando conviven métricas con y sin adorno.
          El fondo sale del MISMO token con color-mix, así el chip se adapta solo al modo oscuro —
          los --chart-N ya traen sus pasos propios validados para esa superficie. */}
      {icono && tono ? (
        <span
          aria-hidden
          className="absolute right-4 top-4 grid size-9 place-items-center rounded-[10px] [&_svg]:size-[18px]"
          style={{ background: `color-mix(in oklab, ${tono} 13%, transparent)`, color: tono }}
        >
          {icono}
        </span>
      ) : null}
      <p
        className={cn(
          "flex items-center gap-1.5 text-[13px] font-medium text-fg-muted",
          icono && tono && "pr-11",
        )}
      >
        {label}
        {/* LA FLECHA ES LA ÚNICA SEÑAL de que la cifra se puede abrir, así que no puede aparecer
            sólo en hover: en touch no hay hover, y con el dedo no existiría. Vive atenuada y se
            enciende al pasar por encima. */}
        {onVer && (
          <ArrowUpRight
            aria-hidden
            className="size-3.5 shrink-0 text-fg-faint transition-colors group-hover:text-brand-text"
          />
        )}
      </p>
      <p className="font-mono text-[28px] font-medium leading-[1.1] tracking-[-0.02em] tabular-nums text-fg">
        {value}
      </p>
      {sub ? (
        <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">{sub}</p>
      ) : null}
    </Contenedor>
  )
}

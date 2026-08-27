import * as React from "react"
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react"

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
  variacion,
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
   * La variación contra el periodo anterior, como la insignia de OkVet.
   *
   * Va con FLECHA además del color: verde y rojo son la peor pareja posible para un daltónico, y
   * ésta es una señal que se lee de un vistazo o no se lee. El `titulo` dice contra qué se compara
   * — un porcentaje sin periodo es un número sin sentido.
   *
   * `null`/ausente = no se pinta nada. Ver `lib/tablero/comparacion.ts`: cuando el periodo
   * anterior fue cero no hay porcentaje honesto, y no decir nada es mejor que inventarlo.
   */
  variacion?: { pct: number; sube: boolean; titulo: string } | null
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
    //
    // ── EL RITMO GRIS/BLANCO, Y POR QUÉ ESTÁ INVERTIDO RESPECTO DE ANTES ────────────────────────
    //
    // El principio no cambió y sigue siendo el mismo que resolvió el problema original: en el
    // tablero había SEIS cajas con exactamente el mismo `rounded-xl border bg-card` —las cuatro
    // métricas, el gráfico y la lista— y sin jerarquía la pantalla se leía como una grilla de
    // ladrillos, sin nada que dijera qué mirar primero. Lo que cambió es QUÉ NIVEL OCUPA CADA UNO.
    //
    // Antes: métricas en gris sin borde, paneles en blanco. Ahora al revés — y lo pidió David
    // mandando su referencia de OkVet: «ves cómo ese cambio de color y de relieve le da
    // profesionalidad y estética… ese toque que le da el contraste gris y blanco».
    //
    // En esa referencia las CIFRAS van en blanco nítido y el desglose —las donas, las listas— en
    // gris. Tiene sentido más allá del gusto: lo blanco se adelanta y lo gris se retira, así que
    // el nivel claro le toca a lo que hay que leer primero. Con la asignación vieja pasaba lo
    // contrario: los números se hundían y el andamiaje se adelantaba.
    //
    // EL «RELIEVE» SE DA CON CONTRASTE, NO CON SOMBRA, y eso no es una interpretación libre: el
    // sistema de diseño del propio David dice, en `globals.css`, que la única sombra permitida es
    // la de popovers y menús. Se le quitó `shadow-sm` a 19 tarjetas por esa regla. Subir estas al
    // blanco contra paneles grises da la separación que él está viendo sin romper su propia norma.
    //
    // EL RADIO Y EL PADDING NO SE TOCAN: los 12px de card y el padding 24 salen del mockup de David
    // y siguen valiendo.
    <Contenedor
      {...(onVer ? { type: "button", onClick: onVer } : {})}
      className={cn(
        "group relative flex flex-col gap-2 rounded-xl border border-line bg-card p-6 text-left",
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
      {/* La cifra y su variación en la MISMA línea, con la insignia apoyada en la base del número:
          es una propiedad de esa cifra, no un dato aparte. */}
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[28px] font-medium leading-[1.1] tracking-[-0.02em] tabular-nums text-fg">
          {value}
        </span>
        {variacion && (
          <span
            title={variacion.titulo}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
              variacion.sube ? "bg-ok-soft text-ok" : "bg-danger-soft text-destructive",
            )}
          >
            {variacion.sube ? (
              <TrendingUp className="size-3" aria-hidden />
            ) : (
              <TrendingDown className="size-3" aria-hidden />
            )}
            {variacion.pct > 0 ? "+" : ""}
            {variacion.pct}%
            <span className="sr-only"> {variacion.titulo}</span>
          </span>
        )}
      </p>
      {sub ? (
        <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">{sub}</p>
      ) : null}
    </Contenedor>
  )
}

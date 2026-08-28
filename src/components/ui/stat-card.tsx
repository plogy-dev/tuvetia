import * as React from "react"
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react"

import { cn } from "@/lib/utils"

// La tarjeta de cifra. Vivía sin exportar dentro de `dashboard/facturacion/page.tsx`, mientras
// otras pantallas se inventaban su propia versión.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// LA PASADA DEL 28-AGO — «QUE SE VEA MENOS IA, TOMA OKVET DE REFERENCIA»
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// David mandó por fin una CAPTURA REAL de `sys.okvet.co/Dashboard`. Importa más de lo que parece:
// `docs/DASHBOARD-2026-08-15.md` dice, en su primer párrafo, que aquella investigación no pudo
// entrar al producto y que todo salía de páginas de marketing — «sé qué dicen que muestra, no cómo
// se ve». Esto es lo que faltaba, y cambia cosas que antes se habían inferido.
//
// Cuatro diferencias medibles entre la captura y lo que teníamos, en orden de cuánto pesan:
//
//  1. LA CIFRA. OkVet la pone en una geométrica redondeada, BOLD, del orden de 44px. Nosotros la
//     teníamos en MONO a 28px. Ése es el cambio que más mueve la aguja, y es el que hace que una
//     pantalla se lea como «panel de programador» en vez de como producto. Contradice la regla que
//     este mismo archivo defendía —«la mono se reserva para valores clínicos y montos»—, y se
//     cambia a sabiendas: la regla salía del mockup, la captura es el producto que él quiere
//     imitar, y entre las dos manda la referencia. `tabular-nums` se queda: sin él las cifras
//     bailan de ancho al recalcularse y la fila entera tiembla.
//
//  2. EL TÍTULO. En OkVet es grande y en negrita («Total de ventas»), con una línea tenue debajo
//     («Resumen»). El nuestro era un rótulo gris de 13px. Un rótulo tenue sobre un número enorme
//     deja la tarjeta sin cabeza; el título tiene que ser título.
//
//  3. LA INSIGNIA DE VARIACIÓN. En la captura es una píldora SÓLIDA de color con el texto en
//     blanco, no un tinte suave. Se pasa a sólida.
//
//  4. LA ACCIÓN. OkVet pone un botón circular con la flecha ↗ arriba a la derecha de cada tarjeta.
//     Nosotros teníamos una flechita de 14px pegada al rótulo, que no se leía como «esto se abre».
//
// LO QUE NO CAMBIA: sigue sin haber sombra. El sistema de diseño del propio David dice, en
// `globals.css`, que la única sombra permitida es la de popovers y menús, y la captura tampoco
// usa sombras — usa RADIO GRANDE y un borde muy claro. Eso sí se copia: el radio sube de 12 a 16.

export function StatCard({
  label,
  subtitulo,
  value,
  sub,
  icono,
  tono,
  variacion,
  onVer,
  className,
}: {
  label: React.ReactNode
  /**
   * La línea tenue bajo el título — el «Resumen» de OkVet.
   *
   * Es opcional a propósito: las decenas de tarjetas que ya existen no la pasan y se ven bien sin
   * ella. Sirve cuando el título solo no dice de qué periodo o de qué recorte habla la cifra.
   */
  subtitulo?: React.ReactNode
  value: React.ReactNode
  /** Pista bajo la cifra: comparación, periodo, unidad. Opcional. */
  sub?: React.ReactNode
  /** Icono de identidad de la cifra. Con `tono`, se pinta como chip de color. Opcional. */
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
    // ── EL RITMO GRIS/BLANCO ────────────────────────────────────────────────────────────────
    //
    // En el tablero había SEIS cajas con exactamente el mismo `rounded-xl border bg-card` —las
    // cuatro métricas, el gráfico y la lista— y sin jerarquía la pantalla se leía como una grilla
    // de ladrillos, sin nada que dijera qué mirar primero.
    //
    // Las CIFRAS van en blanco nítido y el desglose —las donas, las listas— en gris. Lo pidió
    // David mandando su referencia de OkVet: «ves cómo ese cambio de color y de relieve le da
    // profesionalidad y estética… ese toque que le da el contraste gris y blanco». Y tiene sentido
    // más allá del gusto: lo blanco se adelanta y lo gris se retira, así que el nivel claro le toca
    // a lo que hay que leer primero.
    //
    // El relieve se da con CONTRASTE, no con sombra. Es norma del sistema y la captura lo confirma.
    <Contenedor
      {...(onVer ? { type: "button", onClick: onVer } : {})}
      className={cn(
        "group/stat @container/stat relative flex min-h-[8.5rem] flex-col rounded-2xl border border-line bg-card p-6 text-left",
        onVer &&
          "transition-colors hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {/* LA FLECHA ES UN CÍRCULO ARRIBA A LA DERECHA, como en OkVet — y es un `span`, no un
          `button`: la tarjeta entera YA es el botón, y anidar uno dentro de otro es HTML inválido
          y una trampa para el teclado. Es puramente visual (`aria-hidden`); quien navega con
          lector oye el botón de la tarjeta, que es lo correcto.

          No aparece sólo en hover: en pantalla táctil no hay hover y la única señal de que la
          cifra se abre no existiría. Vive atenuada y se enciende al pasar por encima. */}
      {onVer && (
        <span
          aria-hidden
          className="absolute top-4 right-4 grid size-8 place-items-center rounded-full border border-line text-fg-faint transition-colors group-hover/stat:border-brand group-hover/stat:text-brand-text @[42rem]/stat:size-10"
        >
          <ArrowUpRight className="size-4" />
        </span>
      )}

      {/* El chip de identidad va INLINE, a la izquierda del título. Antes estaba absoluto arriba a
          la derecha, que es justo donde ahora vive la flecha — y dos cosas peleando por la misma
          esquina es como se rompen las tarjetas cuando una métrica tiene las dos. */}
      {/* `min-h` en el bloque del encabezado: sin él, una tarjeta con título de una línea y otra
          con título de dos dejan sus cifras a alturas distintas, y la fila se lee torcida. Reserva
          el alto de dos líneas de título — que es lo que ocupa el caso más común cuando el botón
          circular le come ancho al texto. */}
      <div className={cn("flex min-h-[2.6rem] items-start gap-2.5", onVer && "pr-9")}>
        {icono && tono ? (
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-[10px] [&_svg]:size-[18px] @[42rem]/stat:size-11 @[42rem]/stat:rounded-xl @[42rem]/stat:[&_svg]:size-[22px]"
            style={{ background: `color-mix(in oklab, ${tono} 13%, transparent)`, color: tono }}
          >
            {icono}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {/* EL TÍTULO ES UN TÍTULO. 15px semibold en la display, no un rótulo gris de 13. */}
          <p className="font-display text-[17px] leading-[1.15] font-bold tracking-[-0.02em] text-balance text-fg @[18rem]/stat:text-[19px] @[24rem]/stat:text-[22px] @[42rem]/stat:text-[26px]">
            {label}
          </p>
          {subtitulo ? (
            <p className="mt-0.5 text-[13px] leading-snug text-fg-muted @[24rem]/stat:text-[14px] @[42rem]/stat:text-[15px]">
              {subtitulo}
            </p>
          ) : null}
        </div>
      </div>

      {/* EL ORDEN ES EL DE LA CAPTURA: insignia arriba, cifra abajo.
          En OkVet la píldora de variación no va apoyada al lado del número: va SOBRE él, en su
          propio renglón. Cambia más de lo que parece — con la insignia al lado, el número tiene
          que compartir el ancho y nunca puede crecer del todo; encima de él, la cifra se queda con
          la línea entera y es lo primero que se lee, que es de lo que se trata una tarjeta de
          métrica. Es además lo que hace que la fila de tarjetas tenga un pulso vertical parejo. */}
      {variacion && (
        // PÍLDORA SÓLIDA con texto blanco, como la captura.
        //
        // El color sale de los PRIMITIVOS (`--tv-mint-500`, `--tv-red-500`) y no de `--ok` /
        // `--danger`, que es lo que se usaría por reflejo. El motivo es de contraste: en oscuro
        // esos dos tokens se aclaran —`--ok` pasa a menta 300— y el blanco encima deja de leerse.
        // Los primitivos «nunca se reasignan» (así los declara `globals.css`) y estos dos pasos
        // cargan blanco con holgura en los dos temas.
        <span
          title={variacion.titulo}
          className="mt-3 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-white @[24rem]/stat:px-2.5 @[24rem]/stat:py-1 @[24rem]/stat:text-[13px]"
          style={{ background: variacion.sube ? "var(--tv-mint-500)" : "var(--tv-red-500)" }}
        >
          {variacion.sube ? (
            <TrendingUp className="size-3 @[24rem]/stat:size-3.5" aria-hidden />
          ) : (
            <TrendingDown className="size-3 @[24rem]/stat:size-3.5" aria-hidden />
          )}
          {variacion.pct > 0 ? "+" : ""}
          {variacion.pct}%
          <span className="sr-only"> {variacion.titulo}</span>
        </span>
      )}
      {/* LA CIFRA MANDA, y escala con el ancho de la TARJETA, no con el de la ventana.
          La grilla de métricas es `repeat(auto-fit, minmax(220px, 1fr))`: las tarjetas se estiran
          sin techo. En un navegador al 50% de zoom —el que usa el cliente, viewport de ~3.000px
          CSS— cada tarjeta mide unos 756px, y una cifra topada se lee como una caja blanca vacía
          con algo escrito en la esquina. Ése fue el reporte: «se sigue viendo muy AI».
          El escalón de base se queda chico a propósito: con 220px de tarjeta, «COP 4.320.000» no
          entra más grande sin partirse en dos líneas. Medido a 220, 380, 756 y 1.045px. */}
      <p
        className={`font-display font-bold leading-[1] tracking-[-0.04em] tabular-nums text-fg ${
          variacion ? "mt-1.5" : "mt-3"
        } text-[26px] @[15rem]/stat:text-[30px] @[18rem]/stat:text-[36px] @[24rem]/stat:text-[44px] @[32rem]/stat:text-[54px] @[42rem]/stat:text-[62px]`}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-fg-muted @[42rem]/stat:text-[15px]">
          {sub}
        </p>
      ) : null}
    </Contenedor>
  )
}

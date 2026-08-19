import * as React from "react"

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
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  /** Pista bajo la cifra: comparación, periodo, unidad. Opcional. */
  sub?: React.ReactNode
  className?: string
}) {
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
    <div className={cn("flex flex-col gap-2 rounded-xl bg-surface-2 p-6", className)}>
      <p className="text-[13px] font-medium text-fg-muted">{label}</p>
      <p className="font-mono text-[28px] font-medium leading-[1.1] tracking-[-0.02em] tabular-nums text-fg">
        {value}
      </p>
      {sub ? (
        <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">{sub}</p>
      ) : null}
    </div>
  )
}

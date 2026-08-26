// Cuánto vendió la clínica este mes, partido por tipo de ítem — el dato de la dona del tablero.
//
// ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
//
// David, 25-ago, con la captura del dashboard de OkVet: «metámosle algo así como esos diagramas
// con color para que visualmente se vea la métrica». Lo que OkVet pinta ahí es «Totales por
// servicio» — y nosotros TENEMOS ese dato: cada línea de factura emitida trae su `catalog_item_id`
// y el catálogo trae `item_type`. No se inventó ninguna métrica nueva; se le dio forma a una que
// ya estaba en la base. (Su «cumplimiento de la meta» NO se copió: mide contra una meta de ventas
// que no existe acá, y un medidor clavado en 0 % es peor que ninguno.)
//
// ── EL ORDEN DE LOS COLORES ES FIJO, DEL DATO, NO DEL MONTO ───────────────────────────────────
//
// Cada tipo tiene SU color (`--chart-N`) y lo conserva aunque este mes venda más o menos: un color
// que sigue al ranking hace que «Servicios» sea menta en enero y ámbar en febrero, y la dona deja
// de poder leerse de un vistazo. Es la regla de oro de las paletas categóricas.

export type VentaPorTipo = {
  /** El tipo crudo del catálogo, o "OTROS" para líneas libres (sin ítem). */
  tipo: string
  etiqueta: string
  totalCents: number
  /** `var(--chart-N)` — fijo por tipo, ver arriba. */
  color: string
}

/** Etiqueta y color por tipo, en el orden en que se pintan. El color va con el TIPO, no el puesto. */
const TIPOS: ReadonlyArray<{ tipo: string; etiqueta: string; color: string }> = [
  { tipo: "SERVICIO", etiqueta: "Servicios", color: "var(--chart-1)" },
  { tipo: "MEDICAMENTO", etiqueta: "Medicamentos", color: "var(--chart-2)" },
  { tipo: "PRODUCTO", etiqueta: "Productos", color: "var(--chart-3)" },
  { tipo: "INSUMO", etiqueta: "Insumos", color: "var(--chart-4)" },
  { tipo: "OTROS", etiqueta: "Líneas libres", color: "var(--chart-5)" },
]

export type LineaFacturada = {
  total_cents: number
  /** null = línea libre, tecleada sin ítem del catálogo. */
  item_type: string | null
}

/**
 * Agrupa las líneas del mes por tipo. Devuelve SÓLO los tipos con venta —una dona con cuatro
 * gajos de cero es ruido—, en el orden fijo de `TIPOS` (no por monto: ver el comentario).
 *
 * Un `item_type` que no conocemos (si el catálogo gana un tipo nuevo) cae en «Líneas libres» en
 * vez de desaparecer: perder plata de la dona en silencio es peor que rotularla genérico.
 */
export function ventasPorTipo(lineas: LineaFacturada[]): VentaPorTipo[] {
  const conocidos = new Set(TIPOS.map((t) => t.tipo))
  const suma = new Map<string, number>()
  for (const l of lineas) {
    const tipo = l.item_type && conocidos.has(l.item_type) ? l.item_type : "OTROS"
    suma.set(tipo, (suma.get(tipo) ?? 0) + l.total_cents)
  }
  return TIPOS.filter((t) => (suma.get(t.tipo) ?? 0) > 0).map((t) => ({
    tipo: t.tipo,
    etiqueta: t.etiqueta,
    totalCents: suma.get(t.tipo)!,
    color: t.color,
  }))
}

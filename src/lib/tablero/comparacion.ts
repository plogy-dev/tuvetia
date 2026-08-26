// La variación contra el periodo anterior — la insignia con la flecha del tablero.
//
// ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
//
// OkVet la tiene sobre «Total de ventas» («Periodo anterior», con su flecha y su porcentaje en
// rojo o verde) y es lo que David pidió el 26-ago: «más dinámico». Una cifra sola dice cuánto;
// una cifra con su variación dice si eso es bueno, que es la pregunta que uno se hace al mirarla.
//
// ── LA VENTANA SE COMPARA CON LA MISMA ALTURA DEL MES PASADO, NO CON EL MES ENTERO ────────────
//
// Es la decisión que hace que el número sirva. Comparar «lo que va del mes» contra el mes anterior
// COMPLETO da una caída garantizada todos los días 1 al 28 — la clínica aparecería hundiéndose
// cada mes y remontando el último día, y a la semana nadie miraría la insignia. Se compara contra
// el MISMO tiempo transcurrido del mes anterior: si hoy es 8 a las 10 a.m., contra el 1 al 8 a las
// 10 a.m. del mes pasado. Así los dos lados miden lo mismo.
//
// PURO Y SIN RED, como el resto de `lib/tablero/`.

export type Variacion = {
  /** Redondeado a entero. Positivo sube, negativo baja. */
  pct: number
  sube: boolean
}

/**
 * La variación porcentual entre dos periodos.
 *
 * Devuelve `null` cuando NO SE PUEDE calcular honestamente, que es más útil que un número
 * inventado:
 *
 *   · Si el periodo anterior fue 0, no hay porcentaje posible — dividir por cero da infinito, y
 *     rendirlo como «+100 %» sería mentir sobre la escala (pasar de 0 a 1 no es «el doble»).
 *   · Si los dos son 0, no hay nada que comparar.
 *
 * Quien la pinta decide qué hacer con el `null`: hoy, no pintar insignia. Una clínica que arranca
 * no necesita que su tablero le informe que creció un infinito por ciento.
 */
export function variacion(actual: number, anterior: number): Variacion | null {
  if (!Number.isFinite(actual) || !Number.isFinite(anterior)) return null
  if (anterior <= 0) return null
  const pct = Math.round(((actual - anterior) / anterior) * 100)
  return { pct, sube: pct >= 0 }
}

/**
 * La ventana del mes anterior equivalente a lo que va del mes actual.
 *
 * Devuelve `[desde, hasta]` en ISO, listos para un `gte`/`lte` de PostgREST. `hasta` es el mismo
 * instante relativo: el inicio del mes anterior más el tiempo que lleva corrido el actual.
 *
 * El inicio del mes anterior se calcula con `Date.UTC` sobre la fecha YA corrida a Bogotá y se le
 * devuelven las 5 horas, igual que hace el tablero para `monthStart`: hacerlo con `new Date(y, m,
 * d)` tomaría la zona del proceso, que en Vercel es UTC, y el corte se iría cinco horas.
 */
export function ventanaDelMesAnterior(
  ahora: Date,
  inicioDelMesActual: Date,
): { desde: string; hasta: string } {
  const enBogota = new Date(ahora.getTime() - 5 * 3_600_000)
  const inicioAnterior = new Date(
    Date.UTC(enBogota.getUTCFullYear(), enBogota.getUTCMonth() - 1, 1) + 5 * 3_600_000,
  )
  const corrido = ahora.getTime() - inicioDelMesActual.getTime()
  // TOPADO AL INICIO DEL MES ACTUAL, y no es un detalle: los meses no miden lo mismo. El 30 de
  // marzo llevan corridos 29 días, y sumárselos al 1 de febrero cae en el 2 de MARZO — así que la
  // ventana «del mes pasado» se comía los primeros días del actual y esos días quedaban contados
  // en las dos puntas de la comparación, achatando la variación. Pasa en todo mes largo después de
  // uno corto: marzo tras febrero, mayo tras abril.
  const fin = Math.min(inicioAnterior.getTime() + corrido, inicioDelMesActual.getTime())
  return {
    desde: inicioAnterior.toISOString(),
    hasta: new Date(fin).toISOString(),
  }
}

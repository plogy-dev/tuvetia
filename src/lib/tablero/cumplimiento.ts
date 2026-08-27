// Cuánto se lleva de la meta del mes.
//
// ── QUÉ ES Y POR QUÉ NO ES OTRA INSIGNIA MÁS ───────────────────────────────────────────────────
//
// La insignia de variación de las pastillas contesta «¿voy mejor o peor que el mes pasado?». Ésta
// contesta otra cosa: «¿voy a llegar a donde me propuse?». Son preguntas distintas y se responden
// con números distintos — una clínica puede ir +30% contra un mes pésimo y aun así quedar lejos de
// la meta, y con sólo la insignia eso se ve como una buena noticia.
//
// ── EL RITMO, QUE ES LO QUE LA HACE ÚTIL ───────────────────────────────────────────────────────
//
// Un anillo al 40% no dice nada por sí solo: al 40% el día 12 se va sobrando, y al 40% el día 28 no
// se llega. Por eso se calcula ADEMÁS el ritmo —qué porcentaje del mes ya transcurrió— y la lectura
// es la COMPARACIÓN entre los dos. Sin eso el anillo es decoración: bonito, y no cambia ninguna
// decisión.
//
// PURO Y SIN RED: `vitest.config.mts` corre en `environment: "node"` sobre `src/**/*.test.ts`, así
// que la cuenta vive acá y el componente sólo la dibuja.

export type Cumplimiento = {
  /** El porcentaje REAL, que puede pasarse de 100 — superar la meta es información. */
  pct: number
  /**
   * El porcentaje con el que se dibuja el anillo, tapado en 100.
   *
   * No es lo mismo que `pct` a propósito: un arco de 130% da la vuelta y vuelve a empezar, y a la
   * vista queda igual que un 30%. El número de adentro dice 130; el arco se queda lleno.
   */
  pctDeArco: number
  /** Lo que falta en centavos. Nunca negativo: si se superó la meta, es 0. */
  faltanCents: number
  cumplida: boolean
  /**
   * Qué porcentaje del mes ya pasó. Es contra esto que se lee el anillo.
   *
   * `null` cuando no se sabe el día — el componente entonces no pinta la marca, en vez de inventar
   * una posición.
   */
  ritmoPct: number | null
  /** Va en ritmo o mejor. `null` cuando no hay día con el cual compararlo. */
  enRitmo: boolean | null
  /** El token de color del arco. Nunca un hex: la app tiene tema claro y oscuro. */
  color: string
}

/** El día del mes y cuántos días tiene, para el ritmo. */
export type DiaDelMes = { dia: number; dias: number }

/**
 * El cumplimiento, o `null` si no hay meta contra la cual medir.
 *
 * DEVUELVE `null` Y NO CERO cuando la meta no está puesta. Son estados distintos: sin meta el
 * bloque no se pinta —no hay nada que cumplir— mientras que un cero es una meta cargada que va en
 * cero, y ésa sí se muestra. Pintar «0%» a quien nunca puso una meta es reprocharle algo que no
 * eligió.
 */
export function cumplimiento(
  vendidoCents: number,
  metaCents: number | null | undefined,
  hoy?: DiaDelMes,
): Cumplimiento | null {
  if (metaCents == null || !Number.isFinite(metaCents) || metaCents <= 0) return null
  const vendido = Number.isFinite(vendidoCents) && vendidoCents > 0 ? vendidoCents : 0

  const pct = Math.round((vendido / metaCents) * 100)
  const cumplida = vendido >= metaCents

  const ritmoPct = ritmoDelMes(hoy)
  // Se compara con el pct REAL y no con el del arco: al 130% el día 20 se va en ritmo, y taparlo en
  // 100 antes de comparar lo dejaría empatado con quien va justo.
  const enRitmo = ritmoPct == null ? null : pct >= ritmoPct

  return {
    pct,
    pctDeArco: Math.min(100, Math.max(0, pct)),
    faltanCents: Math.max(0, metaCents - vendido),
    cumplida,
    ritmoPct,
    enRitmo,
    color: colorDe(cumplida, enRitmo),
  }
}

/**
 * Qué porcentaje del mes ya transcurrió.
 *
 * El día CUENTA COMPLETO (día 1 de 30 → 3%, no 0%): a mitad del día 1 ya se vendió durante un día,
 * y arrancar el ritmo en cero haría que todo el mundo apareciera «en ritmo» cada día 1.
 */
function ritmoDelMes(hoy?: DiaDelMes): number | null {
  if (!hoy) return null
  const { dia, dias } = hoy
  if (!Number.isFinite(dia) || !Number.isFinite(dias)) return null
  if (dias <= 0 || dia < 1 || dia > dias) return null
  return Math.round((dia / dias) * 100)
}

/**
 * El color del arco.
 *
 * TRES ESTADOS Y NO DOS. Verde/rojo dejaría en rojo a quien va al 60% el día 18 —que va bien— y el
 * rojo permanente se vuelve ruido que se deja de mirar. El ámbar es «atención», que es lo que de
 * verdad pasa cuando se va corto pero queda mes.
 */
function colorDe(cumplida: boolean, enRitmo: boolean | null): string {
  if (cumplida) return "var(--color-ok)"
  // Sin día no hay juicio de ritmo: se pinta en la marca de la casa y no en rojo. Un rojo por no
  // saber el día sería una alarma inventada.
  if (enRitmo == null) return "var(--color-brand)"
  // `--color-warn` Y NO `--color-amber`: ese segundo token NO EXISTE. El `@theme inline` de
  // `globals.css` expone `--color-warn` —el mismo ámbar, `--tv-amber-700` en claro y `#e5c078` en
  // oscuro— y nunca expuso `--color-amber`. O sea que este arco se pintaba con una variable sin
  // valor: el navegador descarta la declaración y el «fuera de ritmo» se quedaba SIN su color de
  // atención, que es justo la señal que esta función existe para dar. Encontrado en la auditoría
  // de UI del 27-ago. El `--amber` crudo tampoco servía: no se redefine en oscuro, así que ahí
  // habría quedado un marrón sobre fondo negro.
  return enRitmo ? "var(--color-brand)" : "var(--color-warn)"
}

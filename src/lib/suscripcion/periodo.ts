// El calendario de la suscripción: cuándo vence un período, cuándo se reintenta, cuándo se corta.
//
// FUNCIONES PURAS, SIN BASE DE DATOS Y SIN `Date.now()` ADENTRO. Todo lo que necesita saber la hora
// la recibe por parámetro. Es lo que permite probar en vitest —que corre en `environment: "node"`—
// los casos que en producción tardarían meses en aparecer: el cobro del 31 de enero, el mes que
// vence un 29 de febrero, la tercera falla consecutiva.
//
// POR QUÉ ESTO NO ES "sumar 30 días". Un mes calendario y 30 días no son lo mismo, y la diferencia
// se acumula: con 30 días fijos, una clínica que se suscribe el 1 de enero termina pagando 12 veces
// en 360 días y a los pocos años cobra dos veces en el mismo mes. Con mes calendario, quien se
// suscribe el 15 paga siempre el 15.

/** Cuántas veces se intenta cobrar un mismo período antes de bajar el plan. */
export const MAX_INTENTOS = 3

/**
 * Cuántos días esperar antes del siguiente intento.
 *
 * 2 y 4 días, no horas. Un rechazo por fondos insuficientes no se arregla en una hora, y reintentar
 * agresivamente contra la misma tarjeta es la forma más rápida de que el emisor empiece a marcar
 * los cobros como sospechosos y rechace también los buenos.
 *
 * Con esta tabla, una clínica que deja de pagar conserva Pro **6 días** antes de bajar. Ese es el
 * período de gracia y es deliberado: el caso común de un rechazo no es alguien que se va, es una
 * tarjeta vencida que nadie actualizó todavía.
 */
const ESPERA_POR_INTENTO: Record<number, number> = { 1: 2, 2: 4 }

/**
 * Días hasta el próximo intento, o `null` si ya no hay más.
 *
 * `null` es la señal de bajar a free: quien llama no tiene que saber cuántos intentos son.
 */
export function diasHastaProximoIntento(intentoQueFallo: number): number | null {
  if (intentoQueFallo >= MAX_INTENTOS) return null
  return ESPERA_POR_INTENTO[intentoQueFallo] ?? null
}

/**
 * El mismo día del mes siguiente.
 *
 * EL CASO QUE ROMPE LAS IMPLEMENTACIONES INGENUAS: `setMonth(mes + 1)` sobre un 31 de enero da el
 * **3 de marzo**, porque febrero no tiene 31 y JavaScript desborda hacia adelante en silencio. Una
 * suscripción que se renueva el 31 de enero se cobraría el 3 de marzo y le regalaría un mes al
 * cliente, todos los años.
 *
 * Acá se sujeta al último día del mes destino: 31 de enero → 28 de febrero (29 en bisiesto). Es lo
 * que hace cualquier pasarela seria, y lo que la gente espera.
 *
 * NO REPONE EL DÍA ORIGINAL en los meses siguientes: si el ciclo cae al 28 de febrero, el próximo
 * es el 28 de marzo. Recordar el "día preferido" original sería más justo, pero pide una columna
 * más y una regla que nadie puede verificar mirando la fecha de renovación. La pérdida son tres
 * días al año en el peor caso, y a favor del cliente.
 */
export function unMesDespues(desde: Date): Date {
  const anio = desde.getUTCFullYear()
  const mes = desde.getUTCMonth()
  const dia = desde.getUTCDate()

  // Día 0 del mes +2 = último día del mes +1. Es la forma estándar de preguntar "¿cuántos días
  // tiene el mes que viene?" sin una tabla de meses ni reglas de bisiesto propias.
  const ultimoDiaDelDestino = new Date(Date.UTC(anio, mes + 2, 0)).getUTCDate()

  return new Date(
    Date.UTC(
      anio,
      mes + 1,
      Math.min(dia, ultimoDiaDelDestino),
      desde.getUTCHours(),
      desde.getUTCMinutes(),
      desde.getUTCSeconds(),
      desde.getUTCMilliseconds(),
    ),
  )
}

/** `YYYY-MM-DD` en UTC. Es la forma de las columnas `date` de `suscripcion_cobros`. */
export function soloFecha(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * La etiqueta del período que se está pagando: `YYYY-MM`.
 *
 * Entra en la referencia del cobro, así que es también lo que hace que dos intentos de cobrar el
 * mismo mes choquen contra la misma referencia en vez de cobrar dos veces.
 */
export function etiquetaDePeriodo(inicio: Date): string {
  return inicio.toISOString().slice(0, 7)
}

export type Periodo = { inicio: Date; fin: Date; etiqueta: string }

/** El período que arranca en `inicio` y dura un mes calendario. */
export function periodoDesde(inicio: Date): Periodo {
  return { inicio, fin: unMesDespues(inicio), etiqueta: etiquetaDePeriodo(inicio) }
}

/**
 * ¿Le toca cobrar a esta clínica?
 *
 * COMPARA CON `<=` Y NO CON `===`. El cron puede no correr un día —GitHub Actions no tiene SLA, y
 * sus schedules se desactivan solos en repos sin actividad—, y con una comparación exacta ese día
 * perdido significaría un mes sin cobrar que nadie recupera. Con `<=`, el barrido siguiente lo
 * levanta.
 */
export function toca(renuevaEn: Date | null, ahora: Date): boolean {
  if (!renuevaEn) return false
  return renuevaEn.getTime() <= ahora.getTime()
}

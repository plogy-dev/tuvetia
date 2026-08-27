// Qué horas se dibujan en la grilla de la agenda.
//
// ── EL PROBLEMA ────────────────────────────────────────────────────────────────────────────────
//
// `react-big-calendar` sin `min`/`max` dibuja las VEINTICUATRO horas. Con los 72 px por hora que
// necesita una cita de media hora para ser legible, eso son 1.728 px de grilla — y al abrir la
// agenda lo primero que se ve son las filas de la madrugada, vacías, con las 8 de la mañana fuera
// de pantalla. Reportado el 27-ago: «el calendario se ve demasiado alargado hacia abajo».
//
// Una clínica atiende diez horas, no veinticuatro. Acotar la grilla a su horario real la deja en un
// tercio del alto sin quitar nada.
//
// ── LA GARANTÍA QUE NO SE PUEDE ROMPER ─────────────────────────────────────────────────────────
//
// Acotar el rango tiene un riesgo que NO es cosmético: una cita fuera del rango no se dibuja
// recortada — DESAPARECE. Una urgencia de las 6 de la mañana, una cirugía que se pasó de las 8 de
// la noche, o una clínica que cambió su horario después de agendar: todas quedarían invisibles en
// la pantalla que existe justamente para no perderlas.
//
// Por eso el rango es la UNIÓN de dos cosas: el horario de atención y las citas que hay cargadas.
// Si hay una cita a las 6, la grilla empieza a las 6, diga lo que diga el horario. La regla en una
// línea: la grilla puede achicarse todo lo que quiera mientras no esconda una cita.
//
// PURO Y SIN `server-only`: lo consume el calendario, que es de cliente. `vitest.config.mts` corre
// en `environment: "node"` sobre `src/**/*.test.ts`, así que la cuenta vive acá y el componente
// sólo la usa.

/** Una franja de `clinic_hours`. Las horas vienen de Postgres como `"08:00:00"`. */
export type FranjaHoraria = { opens_at: string | null; closes_at: string | null }

/** Una cita ya convertida a horario local — que es en el que se dibuja la grilla. */
export type CitaEnPantalla = {
  inicio: Date
  fin: Date
  /**
   * La cita es de día completo (`sin_hora`). NO cuenta para el rango.
   *
   * Y ES LA DIFERENCIA ENTRE QUE ESTO SIRVA O NO. Una cita «sin hora definida» se guarda cubriendo
   * el día —de medianoche a medianoche, así lo hace el trigger de la 0096— así que si contara como
   * cualquier otra, UNA SOLA de ellas estiraría la grilla de 0 a 24 y devolvería el alargue que
   * este módulo entero viene a arreglar.
   *
   * No es una excepción incómoda: es que esas citas **no se dibujan en la grilla**. Van a la franja
   * de día completo de arriba, que no tiene horas. Pedirle horas a la grilla por una cita que no
   * vive en la grilla es lo que no tenía sentido.
   */
  diaCompleto?: boolean
}

export type RangoVisible = {
  /** Primera hora que se dibuja (0–23). */
  desdeHora: number
  /**
   * Última hora que se dibuja (1–24). Es EXCLUSIVA: 19 significa que la última fila es la de las
   * 18:00–19:00. Coincide con lo que `max` espera en react-big-calendar.
   */
  hastaHora: number
}

/**
 * El horario por defecto cuando la clínica no cargó ninguno.
 *
 * 7 a 20 y no 0 a 24: sin horario configurado igual conviene una grilla usable, y estas trece
 * horas cubren con holgura la jornada de cualquier clínica del principal. Quien atienda fuera de
 * eso va a tener sus citas igual —la unión con las citas manda— y en cuanto cargue su horario en
 * Configuración, la grilla se ajusta sola.
 */
const POR_DEFECTO: RangoVisible = { desdeHora: 7, hastaHora: 20 }

/**
 * Una hora de colchón a cada lado del horario de atención.
 *
 * Sin colchón, la primera cita del día queda pegada al borde superior de la grilla y se lee como si
 * estuviera cortada. Y arrastrar una cita quince minutos antes de la apertura —algo que pasa— no
 * tendría espacio donde soltarla.
 */
const COLCHON = 1

/**
 * El rango de horas que la grilla tiene que dibujar.
 *
 * @param franjas Las franjas de atención de la clínica (toda la semana, no sólo hoy: la vista de
 *   semana muestra siete días y el sábado puede abrir distinto).
 * @param citas Las citas que hay cargadas en el rango que se está mirando. Son la garantía de que
 *   acotar no esconda nada.
 */
export function rangoVisible(
  franjas: FranjaHoraria[],
  citas: CitaEnPantalla[] = [],
): RangoVisible {
  const base = deLasFranjas(franjas) ?? POR_DEFECTO

  let desde = base.desdeHora
  let hasta = base.hastaHora

  for (const cita of citas) {
    // Las de día completo se saltean: no se dibujan en la grilla, así que no tienen por qué
    // decidir qué horas dibuja.
    if (cita.diaCompleto) continue
    const i = horaDe(cita.inicio)
    const f = finDe(cita.fin)
    if (i === null || f === null) continue
    // `Math.floor` en el inicio y `Math.ceil` en el fin: una cita de 8:30 a 9:15 necesita que se
    // dibujen las filas de las 8 y de las 9 ENTERAS, no desde las 8:30.
    if (i < desde) desde = i
    if (f > hasta) hasta = f
  }

  // Nunca invertido y nunca fuera del día. Un rango invertido deja a react-big-calendar dibujando
  // una grilla vacía, que es peor que una larga.
  desde = acotar(desde, 0, 23)
  hasta = acotar(hasta, 1, 24)
  if (hasta <= desde) return POR_DEFECTO

  return { desdeHora: desde, hastaHora: hasta }
}

/**
 * El rango que sale del horario de atención, o `null` si no hay ninguna franja legible.
 *
 * Devuelve `null` y no el rango por defecto para que quien llama pueda distinguir «no hay horario»
 * de «el horario da justo estas horas» — son la misma salida hoy, pero no tienen por qué serlo.
 */
function deLasFranjas(franjas: FranjaHoraria[]): RangoVisible | null {
  let abre: number | null = null
  let cierra: number | null = null

  for (const f of franjas) {
    const a = horaDeTexto(f.opens_at)
    const c = finDeTexto(f.closes_at)
    if (a === null || c === null) continue
    // Una franja invertida (cierra antes de abrir) es un dato roto, no un turno nocturno: los
    // horarios de esta app no cruzan la medianoche. Se ignora en vez de estirar la grilla al día
    // entero, que es lo que pasaría si se la tomara en serio.
    if (c <= a) continue
    abre = abre === null ? a : Math.min(abre, a)
    cierra = cierra === null ? c : Math.max(cierra, c)
  }

  if (abre === null || cierra === null) return null

  return {
    desdeHora: acotar(abre - COLCHON, 0, 23),
    hastaHora: acotar(cierra + COLCHON, 1, 24),
  }
}

/** La hora local de un `Date`, hacia abajo. `null` si la fecha es ilegible. */
function horaDe(d: Date): number | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null
  return d.getHours()
}

/**
 * La hora local del FIN de una cita, hacia arriba.
 *
 * Una cita que termina 9:15 necesita que se dibuje la fila de las 9 entera, así que cuenta como 10.
 * Y una que termina justo a las 9:00 en punto NO necesita la fila de las 9: cuenta como 9.
 */
function finDe(d: Date): number | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null
  const h = d.getHours()
  const sueltos = d.getMinutes() > 0 || d.getSeconds() > 0
  return sueltos ? h + 1 : h
}

/** `"08:00:00"` → `8`. `null` si no se puede leer. */
function horaDeTexto(t: string | null): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim())
  if (!m) return null
  const h = Number(m[1])
  if (!Number.isInteger(h) || h < 0 || h > 23) return null
  return h
}

/** `"18:30:00"` → `19` (la fila de las 18 se dibuja entera). `"18:00:00"` → `18`. */
function finDeTexto(t: string | null): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isInteger(h) || h < 0 || h > 24) return null
  return min > 0 ? h + 1 : h
}

function acotar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * El rango como fechas, que es lo que `react-big-calendar` pide en `min`/`max`.
 *
 * La librería sólo mira la HORA de estos `Date`, no el día, pero se arman sobre una fecha real para
 * no depender de eso. `hastaHora === 24` se convierte en las 23:59:59 del mismo día y no en la
 * medianoche del siguiente: `max` a las 00:00 le dice a la librería que el rango termina donde
 * empieza, y dibuja la grilla vacía.
 */
export function comoFechas(rango: RangoVisible, referencia: Date = new Date()) {
  const base = new Date(referencia)
  const min = new Date(base)
  min.setHours(rango.desdeHora, 0, 0, 0)
  const max = new Date(base)
  if (rango.hastaHora >= 24) max.setHours(23, 59, 59, 999)
  else max.setHours(rango.hastaHora, 0, 0, 0)
  return { min, max }
}

// La grilla de un mes: las seis filas de siete días que pinta el mini calendario.
//
// ── POR QUÉ ESTO ES UN ARCHIVO Y NO CUATRO LÍNEAS DENTRO DEL COMPONENTE ────────────────────────
//
// Porque un calendario mensual es aritmética de fechas, y la aritmética de fechas es donde este
// repositorio ya se cortó dos veces:
//
//   · `new Date("2026-08-01")` se parsea como medianoche UTC, y formatearlo en Bogotá lo retrocede
//     al 31 de julio (ver `date-utils.ts`, `bogotaDateOnly`).
//   · `new Date(2026, 1, 30)` NO es una fecha inválida: rueda sola a marzo, en silencio.
//
// Un mini calendario que se equivoca en un día es peor que no tenerlo: se usa para SALTAR a una
// fecha, y saltar al día equivocado manda al vet a mirar la agenda de otro día creyendo que es la
// de hoy.
//
// Todo acá trabaja con `YYYY-MM-DD` —el calendario del negocio, sin hora ni zona— y se arma con
// `Date.UTC`, que es lo único que no depende de dónde corra el navegador.

/** Un día de la grilla. `iso` es `YYYY-MM-DD`. */
export type DiaDelMes = {
  iso: string
  /** El número que se pinta. */
  dia: number
  /** Si pertenece al mes que se está mirando o es relleno del anterior/siguiente. */
  delMes: boolean
}

/** Lunes primero, que es como se lee un calendario en Colombia. */
export const DIAS_DE_LA_SEMANA = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"] as const

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const

function aISO(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** El día de la semana con LUNES = 0. `getUTCDay()` da domingo = 0, que corre la grilla un día. */
function lunesPrimero(t: number): number {
  return (new Date(t).getUTCDay() + 6) % 7
}

/**
 * Las seis semanas de la grilla, siempre 42 días.
 *
 * SIEMPRE SEIS FILAS, incluso cuando el mes entra en cinco. Con un número variable, el panel cambia
 * de alto al pasar de mes y todo lo que tiene debajo salta — y el salto ocurre justo mientras
 * alguien está apuntando con el mouse al botón de siguiente.
 */
export function grillaDelMes(ancla: string): DiaDelMes[] {
  const [a, m] = ancla.slice(0, 10).split("-").map(Number)
  if (!a || !m) return []

  const primero = Date.UTC(a, m - 1, 1)
  // Se retrocede hasta el lunes de esa semana: ahí arranca la grilla.
  const inicio = primero - lunesPrimero(primero) * 86_400_000

  return Array.from({ length: 42 }, (_, i) => {
    const t = inicio + i * 86_400_000
    const d = new Date(t)
    return {
      iso: aISO(t),
      dia: d.getUTCDate(),
      delMes: d.getUTCMonth() === m - 1 && d.getUTCFullYear() === a,
    }
  })
}

/** "Agosto 2026", para el encabezado del mini calendario. */
export function nombreDelMes(ancla: string): string {
  const [a, m] = ancla.slice(0, 10).split("-").map(Number)
  if (!a || !m || m < 1 || m > 12) return ""
  const nombre = MESES[m - 1]
  return `${nombre[0].toUpperCase()}${nombre.slice(1)} ${a}`
}

/**
 * El mes anterior y el siguiente, como `YYYY-MM-01`.
 *
 * `Date.UTC` se encarga del desborde de año solo: mes 12 rueda a enero del siguiente, mes -1 a
 * diciembre del anterior. Hacerlo a mano es donde aparece el diciembre que salta a enero del MISMO
 * año.
 */
export function mesVecino(ancla: string, delta: -1 | 1): string {
  const [a, m] = ancla.slice(0, 10).split("-").map(Number)
  if (!a || !m) return ancla
  return aISO(Date.UTC(a, m - 1 + delta, 1))
}

/** El `YYYY-MM-DD` de un `Date`, visto desde Bogotá — para marcar "hoy" y el día seleccionado. */
export function isoEnBogota(d: Date): string {
  // `en-CA` da `YYYY-MM-DD` directo, que es exactamente la forma que usa todo este módulo.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d)
}

/**
 * Un `YYYY-MM-DD` al `Date` que representa ese día en Bogotá.
 *
 * Es la vuelta que hace falta para que hacer clic en el mini calendario mueva la grilla: la grilla
 * trabaja con `Date`, el mini calendario con texto. Se ancla al MEDIODÍA y no a la medianoche —
 * medianoche en un huso a la izquierda de UTC cae en el día anterior, y el calendario saltaría un
 * día para atrás en cuanto alguien lo abra desde otra zona horaria.
 */
export function fechaDesdeISO(iso: string): Date {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(a, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0)
}

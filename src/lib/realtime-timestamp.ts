// Un mismo `timestamptz` NO llega igual por los dos caminos que alimentan la bandeja de WhatsApp.
// Medido contra el proyecto principal el 2026-08-01 con `select now()::text, to_json(now())::text`:
//
//   PostgREST (datos iniciales y puesta al día)   2026-08-01T19:19:20.686681+00:00   ← JSON de Postgres
//   Realtime  (eventos de postgres_changes)       2026-08-01 19:19:20.686681+00      ← texto del WAL
//
// Realtime entrega los valores tal como Postgres los escribe en el WAL: separador ESPACIO y offset
// de dos dígitos. Y eso importa porque la bandeja compara `created_at` como STRING —el cursor de la
// puesta al día y el orden de las conversaciones— y `' '` (0x20) es menor que `'T'` (0x54): un
// mensaje recién llegado por Realtime ordenaba por debajo de todos los que vinieron por PostgREST,
// así que su conversación no subía a la cabeza de la lista. Peor: el handler de UPDATE fusiona la
// fila entera, con lo que cada tick de entregado/leído pisaba un `created_at` bueno con uno del WAL.
//
// La conversión es TEXTUAL a propósito. Pasar por `new Date(...).toISOString()` perdería los
// microsegundos y devolvería `…686Z`, que compara DISTINTO del `…686681+00:00` de PostgREST para el
// mismo instante — o sea que cambiaría un desorden por otro. Acá sólo se toca lo que difiere: el
// separador y los minutos del offset.
const TIMESTAMP_DEL_WAL =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/

/**
 * Deja un `timestamptz` de Realtime con la misma forma exacta que el de PostgREST.
 *
 * Lo que ya viene en ISO (o cualquier cosa que no reconozca) se devuelve intacto: la función se
 * aplica en el borde, sobre filas que a veces vienen de un camino y a veces del otro.
 */
export function normalizarTimestamp<T extends string | null | undefined>(valor: T): T {
  if (typeof valor !== "string") return valor
  const m = TIMESTAMP_DEL_WAL.exec(valor)
  if (!m) return valor as T
  const [, fecha, hora, offsetHoras, offsetMinutos] = m
  return `${fecha}T${hora}${offsetHoras}:${offsetMinutos ?? "00"}` as T
}

/**
 * Normaliza los campos de fecha de una fila que llega por Realtime. **Toda suscripción nueva tiene
 * que pasar su `payload.new` por acá antes de tocar el estado.**
 *
 * Existe como helper compartido y no como función local de cada bandeja porque ya pasó dos veces: se
 * arregló en la de WhatsApp el 01-ago y la de correo, escrita en paralelo, nació con el mismo
 * defecto. Una regla que hay que recordar se olvida; una función que se importa, no.
 */
export function normalizarFilaRealtime<T extends Record<string, unknown>>(
  fila: T,
  campos: readonly (keyof T)[],
): T {
  const salida = { ...fila }
  for (const campo of campos) {
    const valor = salida[campo]
    if (typeof valor === "string") {
      salida[campo] = normalizarTimestamp(valor) as T[keyof T]
    }
  }
  return salida
}

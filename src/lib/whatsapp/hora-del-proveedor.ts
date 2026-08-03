// La hora en que el titular escribió, no la hora en que nos llegó el webhook.
//
// Los dos proveedores la mandan en SEGUNDOS desde epoch y ninguno la usaba: Evolution en
// `messageTimestamp` (declarada en el tipo y jamás leída) y Meta en `timestamp` (leída sólo para los
// acuses de entrega). El hilo se ordenaba por `created_at`, o sea por orden de llegada, y ese orden
// lo invierte cualquier reintento del webhook o dos mensajes seguidos.
//
// POR QUÉ SE DESCARTAN VALORES RAROS. Una fecha basura no desordena un mensaje: lo entierra. Como es
// la clave de orden del hilo, un 0 lo manda al principio de la conversación para siempre y una fecha
// del futuro —un teléfono con el reloj mal puesto, que existe— lo clava arriba de todo. Devolver
// null es lo correcto: quien llama omite la columna y el default `now()` pone la hora de llegada,
// que es peor referencia pero nunca es absurda.
//
// El margen de 24 h hacia adelante no es simetría: es que las zonas horarias y un reloj algo
// adelantado son normales, mientras que un mensaje de mañana no lo es. Hacia atrás no hay tope a
// propósito — al sincronizar un teléfono que estuvo sin señal llegan mensajes viejos de verdad, y
// esos SÍ van donde su fecha dice.
const MARGEN_FUTURO_MS = 24 * 60 * 60 * 1000

export function horaDelProveedor(
  segundos: number | string | null | undefined,
  ahora: number = Date.now(),
): string | null {
  if (segundos === null || segundos === undefined || segundos === "") return null
  const n = Number(segundos)
  if (!Number.isFinite(n) || n <= 0) return null
  const ms = n * 1000
  if (ms > ahora + MARGEN_FUTURO_MS) return null
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

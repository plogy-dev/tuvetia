// Los acuses de WhatsApp: cuándo se entregó y cuándo se leyó lo que mandamos.
//
// ── EL DEFECTO QUE ESTO CIERRA ────────────────────────────────────────────────────────────────
//
// Medido el 23-ago: **0 de 3.491 mensajes salientes** tenían `delivered_at` o `read_at`. Todo lo
// que manda la clínica se queda en un check, para siempre — y eso incluye los recordatorios de
// cobranza, donde saber si el titular LEYÓ es la diferencia entre «no le llegó» y «no quiere pagar».
//
// La cadena estaba casi entera: la bandeja lee los dos campos y pinta el tick, y el webhook de Meta
// los escribe. Pero producción corre EVOLUTION, y su suscripción no incluía `MESSAGES_UPDATE`, que
// es por donde Baileys manda los acuses. Nunca llegaban.
//
// ── LOS ESTADOS DE BAILEYS ────────────────────────────────────────────────────────────────────
//
// Evolution reenvía el estado de Baileys, y lo hace de dos formas según versión: el NOMBRE
// (`"DELIVERY_ACK"`) o el NÚMERO del enum (`3`). Se aceptan los dos, porque acá no hay forma de
// probar contra la versión que corra mañana y equivocarse significa volver a cero acuses.
//
//   0 ERROR · 1 PENDING · 2 SERVER_ACK · 3 DELIVERY_ACK · 4 READ · 5 PLAYED
//
// `SERVER_ACK` es «el servidor de WhatsApp lo recibió», que es el primer check y ya lo representa
// `created_at`: no escribe nada.

/** Qué hay que sellar en la fila, si algo. */
export type Acuse = "entregado" | "leido" | null

/** Los nombres y números que Baileys/Evolution usan para cada estado. */
const ENTREGADO = new Set(["DELIVERY_ACK", "DELIVERED", "3"])
const LEIDO = new Set(["READ", "PLAYED", "4", "5"])

/**
 * Traduce el estado que manda Evolution a lo que corresponde sellar.
 *
 * `PLAYED` (una nota de voz escuchada) cuenta como LEÍDO: para el vet significa lo mismo —el
 * titular consumió el mensaje— y tener un tercer estado que la bandeja no sabe pintar sería
 * información que se pierde.
 */
export function acuseDe(estado: unknown): Acuse {
  if (estado === null || estado === undefined) return null
  const s = String(estado).trim().toUpperCase()
  if (LEIDO.has(s)) return "leido"
  if (ENTREGADO.has(s)) return "entregado"
  return null
}

/**
 * Los campos a escribir para un acuse, contra lo que la fila YA tiene.
 *
 * ── POR QUÉ NUNCA SE PISA LO QUE YA ESTÁ ──────────────────────────────────────────────────────
 *
 * Los webhooks llegan desordenados y se reintentan. Si un `DELIVERY_ACK` tardío aterriza después de
 * un `READ` —y pasa— reescribir a ciegas movería el mensaje de «leído» a «entregado»: el tick azul
 * se volvería gris solo, y el vet vería que el titular «des-leyó» su mensaje.
 *
 * Por eso cada sello se pone UNA vez: si el campo ya tiene fecha, se respeta la primera. La primera
 * es además la buena — es la hora en que de verdad pasó, no la del reintento.
 *
 * ── Y LEÍDO IMPLICA ENTREGADO ─────────────────────────────────────────────────────────────────
 *
 * Si el primer acuse que llega es `READ` —porque el de entrega se perdió, que también pasa— se
 * sellan los dos. Un mensaje leído y «no entregado» es un estado que no existe, y la bandeja lo
 * pintaría como si siguiera en camino.
 */
export function camposDelAcuse(
  acuse: Acuse,
  actual: { delivered_at: string | null; read_at: string | null },
  ahora: string,
): { delivered_at?: string; read_at?: string } {
  if (!acuse) return {}
  const campos: { delivered_at?: string; read_at?: string } = {}
  if (!actual.delivered_at) campos.delivered_at = ahora
  if (acuse === "leido" && !actual.read_at) campos.read_at = ahora
  return campos
}

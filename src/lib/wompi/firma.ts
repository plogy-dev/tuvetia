// Las dos firmas de Wompi. Son distintas, se calculan distinto y protegen cosas opuestas.
//
//   · **Integridad** (saliente) — la firmamos NOSOTROS y viaja en cada cobro. Impide que alguien
//     que intercepte la petición cambie el monto o la referencia.
//   · **Checksum de evento** (entrante) — la firma WOMPI y viaja en cada webhook. Es lo único que
//     distingue un aviso real de "te pagaron" de un POST que armó cualquiera contra una URL pública.
//
// SIN `server-only`, PERO NO ES PARA EL NAVEGADOR. Se deja importable para poder probarlo en
// vitest, que corre en `environment: "node"`. Los secretos no viven acá: entran por parámetro. Ese
// es justamente el motivo de que este archivo no lea `process.env` — un módulo puro se prueba con
// los vectores de la documentación de Wompi, y esos vectores son la única forma de saber que la
// concatenación está bien ANTES de mover plata de verdad.

import { createHash, timingSafeEqual } from "node:crypto"

function sha256Hex(entrada: string): string {
  return createHash("sha256").update(entrada, "utf8").digest("hex")
}

// ── Firma de integridad (la que mandamos) ──────────────────────────────────────────────────────

/**
 * La firma que acompaña a cada transacción.
 *
 * El orden de la concatenación NO es negociable y no es alfabético:
 *
 *     referencia + monto_en_centavos + moneda + [vencimiento] + secreto_de_integridad
 *
 * `vencimiento` sólo entra si se usa, y va ANTES del secreto. Meterlo en cualquier otro lugar
 * produce una firma que Wompi rechaza con un mensaje genérico sobre la firma, sin decir dónde está
 * el problema — de ahí que esto tenga test con el vector de la documentación.
 *
 * El monto se interpola como entero: un `20000000.0` de un float mal manejado cambia la cadena y
 * por lo tanto el hash, aunque el número sea el mismo.
 */
export function firmaDeIntegridad(params: {
  referencia: string
  montoCentavos: number
  moneda: string
  secretoIntegridad: string
  /** ISO8601, opcional. Sólo si la transacción lleva `expiration_time`. */
  vencimiento?: string
}): string {
  const { referencia, montoCentavos, moneda, secretoIntegridad, vencimiento } = params

  if (!Number.isInteger(montoCentavos)) {
    throw new Error(`El monto debe ser un entero de centavos, llegó ${montoCentavos}`)
  }

  const cadena =
    `${referencia}${montoCentavos}${moneda}` +
    (vencimiento ? vencimiento : "") +
    secretoIntegridad

  return sha256Hex(cadena)
}

// ── Checksum de eventos (el que verificamos) ───────────────────────────────────────────────────

/** La forma del webhook, reducida a lo que hace falta para validarlo. */
export type EventoWompi = {
  event?: string
  data?: unknown
  /** Los campos que entran al checksum, como rutas con punto: `transaction.id`. */
  signature?: { properties?: string[]; checksum?: string }
  /** UNIX en segundos. Entra a la cadena tal cual. */
  timestamp?: number
  sent_at?: string
}

/**
 * Saca un valor anidado de `data` siguiendo una ruta con puntos.
 *
 * Devuelve `undefined` —y no lanza— cuando la ruta no existe: un evento con una propiedad que no
 * está es un evento que no valida, no una excepción a 500. Un webhook que revienta con 500 hace que
 * Wompi lo reintente, y reintentar un evento malformado no lo arregla.
 */
function valorEnRuta(raiz: unknown, ruta: string): unknown {
  let actual: unknown = raiz
  for (const tramo of ruta.split(".")) {
    if (actual === null || typeof actual !== "object") return undefined
    actual = (actual as Record<string, unknown>)[tramo]
  }
  return actual
}

/**
 * Rearma el checksum que Wompi dice haber calculado.
 *
 *     valores de signature.properties (en ORDEN) + timestamp + secreto_de_eventos
 *
 * El orden lo dicta el propio evento, no nosotros: por eso se recorre `properties` tal como viene y
 * no una lista nuestra. Wompi puede agregar propiedades y el cálculo sigue funcionando.
 *
 * Devuelve `null` cuando el evento no trae lo mínimo para calcularlo, que se trata igual que un
 * checksum que no coincide.
 */
export function checksumEsperado(evento: EventoWompi, secretoEventos: string): string | null {
  const propiedades = evento.signature?.properties
  if (!Array.isArray(propiedades) || propiedades.length === 0) return null
  if (typeof evento.timestamp !== "number") return null

  let cadena = ""
  for (const ruta of propiedades) {
    const valor = valorEnRuta(evento.data, ruta)
    // Un `undefined` interpolado escribiría literalmente "undefined" en la cadena y produciría un
    // hash que no coincide con nada. Mejor cortar y decir que no se pudo validar.
    if (valor === undefined || valor === null) return null
    cadena += String(valor)
  }

  cadena += String(evento.timestamp)
  cadena += secretoEventos

  return sha256Hex(cadena)
}

/**
 * ¿Este evento lo mandó Wompi?
 *
 * COMPARACIÓN EN TIEMPO CONSTANTE. Un `===` sobre hashes filtra, por lo que tarda en fallar, cuántos
 * caracteres iniciales acertó quien lo intenta; con suficientes intentos eso permite construir un
 * checksum válido byte a byte. `timingSafeEqual` tarda lo mismo siempre.
 *
 * Las longitudes se comparan antes porque `timingSafeEqual` LANZA si difieren — y esa comparación
 * no filtra nada útil: el largo de un SHA256 es público.
 */
export function eventoEsAutentico(
  evento: EventoWompi,
  secretoEventos: string,
  checksumRecibido?: string | null,
): boolean {
  const esperado = checksumEsperado(evento, secretoEventos)
  if (!esperado) return false

  // El checksum llega por dos vías —la cabecera `X-Event-Checksum` y el cuerpo— y se acepta
  // cualquiera de las dos. Wompi manda las dos con el mismo valor; que el llamador pase la de la
  // cabecera es preferible, porque un atacante que arme el cuerpo entero controla la del cuerpo.
  const recibido = (checksumRecibido ?? evento.signature?.checksum ?? "").trim()
  if (!recibido) return false

  const a = Buffer.from(esperado.toLowerCase(), "utf8")
  const b = Buffer.from(recibido.toLowerCase(), "utf8")
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

// ── Referencia del cobro ───────────────────────────────────────────────────────────────────────

/**
 * La referencia con la que se identifica un cobro, y con la que se evita cobrar dos veces.
 *
 * Wompi RECHAZA una transacción con una referencia ya usada. Eso lo convierte en la llave de
 * idempotencia del sistema: si el cron se dispara dos veces por el mismo mes, el segundo cobro
 * choca contra la misma referencia y no pasa. La tabla `suscripcion_cobros` tiene el mismo `unique`,
 * así que las dos capas dicen lo mismo.
 *
 * El período va en la referencia a propósito: hace que "el cobro de septiembre" sea una sola cosa
 * aunque se intente cinco veces —el intento va aparte— y hace que la referencia sea legible cuando
 * hay que rastrear un pago en el panel de Wompi.
 *
 * Sólo `[A-Za-z0-9-]`: los guiones bajos y los puntos han dado problemas en el panel de Wompi al
 * buscar, y el uuid de la clínica ya trae sus propios guiones.
 */
export function referenciaDeCobro(params: {
  clinicId: string
  /** El mes que se paga, `YYYY-MM`. */
  periodo: string
  intento: number
}): string {
  const { clinicId, periodo, intento } = params
  const limpio = clinicId.replace(/[^A-Za-z0-9-]/g, "")
  return `tuvetia-${limpio}-${periodo.replace(/[^0-9-]/g, "")}-${intento}`
}

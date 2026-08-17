import "server-only"

// Las llamadas a Wompi que se hacen desde el servidor.
//
// LO QUE NO ESTÁ ACÁ, Y ES A PROPÓSITO: tokenizar la tarjeta. Ese paso lo hace el NAVEGADOR contra
// Wompi directo, con la llave pública (`tokenizar-tarjeta.ts`). Si pasara por acá, el número de
// tarjeta atravesaría nuestro servidor y nuestros logs, y el alcance PCI de Tuvetia dejaría de ser
// el mínimo. Al servidor sólo le llega un token, que ya no es una tarjeta.
//
// DOS COSAS QUE ESTA CAPA SÍ HACE Y SON FÁCILES DE OLVIDAR:
//
//   1. **Nunca lanza por un fallo de red o un 4xx.** Devuelve un resultado. Un `throw` acá termina
//      en un 500 genérico en la pantalla de pago, donde lo que hace falta es "tu banco rechazó la
//      tarjeta" — que es información que Wompi sí manda y que se pierde si se convierte en excepción.
//   2. **Registra el cuerpo del error de Wompi en el log del servidor.** Sus mensajes de validación
//      son específicos (qué campo, por qué) y no llegan al navegador; sin log, un rechazo por firma
//      mal armada es indistinguible de uno por tarjeta sin fondos.

import { configWompi, type ConfigWompi } from "@/lib/wompi/config"
import { firmaDeIntegridad } from "@/lib/wompi/firma"

export type Fallo = { ok: false; mensaje: string; detalle?: unknown }
export type Exito<T> = { ok: true; data: T }
export type Resultado<T> = Exito<T> | Fallo

/** Timeout de cada llamada. Wompi responde en cientos de ms; 15s es "algo se colgó". */
const TIMEOUT_MS = 15_000

async function pedir<T>(
  cfg: ConfigWompi,
  ruta: string,
  init: { metodo: "GET" | "POST"; llave: string; cuerpo?: unknown },
): Promise<Resultado<T>> {
  const url = `${cfg.baseUrl}${ruta}`
  try {
    const res = await fetch(url, {
      method: init.metodo,
      headers: {
        Authorization: `Bearer ${init.llave}`,
        ...(init.cuerpo ? { "Content-Type": "application/json" } : {}),
      },
      body: init.cuerpo ? JSON.stringify(init.cuerpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Estas llamadas mueven plata: nunca deben servirse de una caché.
      cache: "no-store",
    })

    const texto = await res.text()
    let json: unknown = null
    try {
      json = texto ? JSON.parse(texto) : null
    } catch {
      // Wompi devolviendo algo que no es JSON es señal de caída o de una URL equivocada.
      console.error(`wompi ${init.metodo} ${ruta}: respuesta no-JSON (${res.status})`, texto.slice(0, 500))
      return { ok: false, mensaje: "Wompi devolvió una respuesta inesperada." }
    }

    if (!res.ok) {
      console.error(`wompi ${init.metodo} ${ruta}: ${res.status}`, JSON.stringify(json).slice(0, 1000))
      return { ok: false, mensaje: mensajeDeError(json, res.status), detalle: json }
    }

    return { ok: true, data: (json as { data: T }).data }
  } catch (e) {
    // Timeout o red. El cobro PUEDE haberse ejecutado igual: quien llame tiene que dejar el cobro
    // en PENDIENTE y dejar que el webhook lo resuelva, nunca reintentar con la misma referencia
    // dándolo por fallido.
    console.error(`wompi ${init.metodo} ${ruta}: sin respuesta`, e)
    return { ok: false, mensaje: "No pudimos comunicarnos con la pasarela de pagos." }
  }
}

/** Saca algo legible del cuerpo de error de Wompi, que anida los mensajes por campo. */
function mensajeDeError(json: unknown, status: number): string {
  const error = (json as { error?: { type?: string; reason?: string; messages?: Record<string, string[]> } })?.error
  if (error?.reason) return error.reason

  if (error?.messages) {
    const primero = Object.entries(error.messages)[0]
    if (primero) return `${primero[0]}: ${primero[1]?.[0] ?? "inválido"}`
  }
  if (status === 401 || status === 403) return "La pasarela rechazó nuestras credenciales."
  if (status === 422) return "La pasarela rechazó los datos del pago."
  return "La pasarela de pagos devolvió un error."
}

// ── Tokens de aceptación ───────────────────────────────────────────────────────────────────────

export type TokensDeAceptacion = {
  /** Términos y condiciones de Wompi. Obligatorio en toda fuente de pago. */
  acceptance_token: string
  /** Autorización de tratamiento de datos personales. También obligatorio. */
  accept_personal_auth: string
  /** Las URLs de los documentos, para poder enlazarlos en el formulario. */
  urls: { terminos: string | null; datos: string | null }
}

type MerchantResponse = {
  presigned_acceptance?: { acceptance_token?: string; permalink?: string }
  presigned_personal_data_auth?: { acceptance_token?: string; permalink?: string }
}

/**
 * Los dos tokens que Wompi exige para crear una fuente de pago.
 *
 * Son de vida corta y no se cachean: pedirlos es una llamada barata, y usar uno vencido devuelve un
 * error de validación difícil de leer. Se piden justo antes de crear la fuente.
 *
 * ENLAZAR LOS PERMALINKS NO ES OPCIONAL. Mandar el token sin haberle mostrado al usuario qué está
 * aceptando es exactamente lo que la Ley 1581 no permite, y además es lo que hace que la aceptación
 * valga algo si alguien la discute.
 */
export async function tokensDeAceptacion(): Promise<Resultado<TokensDeAceptacion>> {
  const cfg = configWompi()
  if (!cfg.ok) return { ok: false, mensaje: "Los pagos no están configurados." }

  const res = await pedir<MerchantResponse>(cfg.config, `/merchants/${cfg.config.llavePublica}`, {
    metodo: "GET",
    llave: cfg.config.llavePublica,
  })
  if (!res.ok) return res

  const aceptacion = res.data.presigned_acceptance?.acceptance_token
  const datos = res.data.presigned_personal_data_auth?.acceptance_token
  if (!aceptacion || !datos) {
    console.error("wompi /merchants: faltan tokens de aceptación", res.data)
    return { ok: false, mensaje: "La pasarela no entregó los términos que hay que aceptar." }
  }

  return {
    ok: true,
    data: {
      acceptance_token: aceptacion,
      accept_personal_auth: datos,
      urls: {
        terminos: res.data.presigned_acceptance?.permalink ?? null,
        datos: res.data.presigned_personal_data_auth?.permalink ?? null,
      },
    },
  }
}

// ── Fuente de pago ─────────────────────────────────────────────────────────────────────────────

export type FuenteDePago = {
  id: number
  status: string
  type: string
  public_data?: { type?: string; brand?: string; last_four?: string; exp_month?: string; exp_year?: string }
}

/**
 * Guarda la tarjeta tokenizada como fuente de pago reutilizable.
 *
 * ES EL ÚNICO PASO QUE NECESITA LA PRESENCIA DEL CLIENTE. De acá en adelante los cobros mensuales
 * salen solos con `id`, sin que nadie tenga que volver a escribir la tarjeta.
 *
 * `status` puede volver distinto de `AVAILABLE` cuando el emisor exige autenticación 3DS. Quien
 * llame tiene que mirarlo y no dar por hecho que quedó lista.
 */
export async function crearFuenteDePago(params: {
  token: string
  correo: string
  acceptanceToken: string
  acceptPersonalAuth: string
}): Promise<Resultado<FuenteDePago>> {
  const cfg = configWompi()
  if (!cfg.ok) return { ok: false, mensaje: "Los pagos no están configurados." }

  return pedir<FuenteDePago>(cfg.config, "/payment_sources", {
    metodo: "POST",
    llave: cfg.config.llavePrivada,
    cuerpo: {
      type: "CARD",
      token: params.token,
      customer_email: params.correo,
      acceptance_token: params.acceptanceToken,
      accept_personal_auth: params.acceptPersonalAuth,
    },
  })
}

// ── Cobro ──────────────────────────────────────────────────────────────────────────────────────

export type Transaccion = {
  id: string
  status: "PENDING" | "APPROVED" | "DECLINED" | "VOIDED" | "ERROR"
  reference: string
  amount_in_cents: number
  status_message?: string | null
  payment_method_type?: string
}

/**
 * Le cobra a una fuente de pago guardada.
 *
 * `recurrent: true` marca el cobro como Credential On File: le dice a la franquicia que el titular
 * autorizó cargos periódicos del mismo monto. Sube la tasa de aprobación —un cobro sin presencia
 * del titular y sin esta marca se parece bastante a un fraude desde el lado del emisor— pero sólo
 * aplica a VISA y Mastercard procesadas por RBM; con cualquier otra combinación Wompi lo ignora en
 * silencio y el cobro sale igual.
 *
 * NACE EN `PENDING`, CASI SIEMPRE. La respuesta inmediata rara vez trae el resultado final: quien
 * llame NO debe tratar un `PENDING` como fracaso. El estado definitivo llega por webhook.
 */
export async function cobrarAFuenteDePago(params: {
  fuenteDePagoId: number
  correo: string
  montoCentavos: number
  referencia: string
  cuotas?: number
}): Promise<Resultado<Transaccion>> {
  const cfg = configWompi()
  if (!cfg.ok) return { ok: false, mensaje: "Los pagos no están configurados." }

  const moneda = "COP"
  const firma = firmaDeIntegridad({
    referencia: params.referencia,
    montoCentavos: params.montoCentavos,
    moneda,
    secretoIntegridad: cfg.config.secretoIntegridad,
  })

  return pedir<Transaccion>(cfg.config, "/transactions", {
    metodo: "POST",
    llave: cfg.config.llavePrivada,
    cuerpo: {
      amount_in_cents: params.montoCentavos,
      currency: moneda,
      signature: firma,
      customer_email: params.correo,
      reference: params.referencia,
      payment_source_id: params.fuenteDePagoId,
      recurrent: true,
      // Una cuota: es una suscripción mensual, no una compra a plazos.
      payment_method: { installments: params.cuotas ?? 1 },
    },
  })
}

/**
 * Consulta el estado real de una transacción.
 *
 * ES LA FUENTE DE VERDAD cuando el webhook no llegó, o cuando el navegador vuelve de la pasarela.
 * La redirección del navegador NUNCA se usa para confirmar un pago: cualquiera puede visitar esa
 * URL con el `id` que quiera.
 */
export async function consultarTransaccion(id: string): Promise<Resultado<Transaccion>> {
  const cfg = configWompi()
  if (!cfg.ok) return { ok: false, mensaje: "Los pagos no están configurados." }

  return pedir<Transaccion>(cfg.config, `/transactions/${encodeURIComponent(id)}`, {
    metodo: "GET",
    llave: cfg.config.llavePrivada,
  })
}

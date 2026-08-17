// La tokenización de la tarjeta, DESDE EL NAVEGADOR.
//
// POR QUÉ NO ES DEL SERVIDOR, QUE SERÍA MÁS CÓMODO. Si el formulario mandara la tarjeta a una ruta
// nuestra y desde ahí a Wompi, el número completo pasaría por nuestro servidor, por sus logs, por
// el proxy de Vercel y por cualquier herramienta de trazas que haya en el medio. Eso mete a Tuvetia
// de lleno en el alcance PCI-DSS más pesado, por comodidad.
//
// Mandándolo directo del navegador a Wompi, el número no toca nunca nuestra infraestructura: al
// servidor le llega un token que no sirve para nada fuera de nuestra cuenta. Es la razón por la que
// la llave pública es pública.
//
// LO QUE ESTE ARCHIVO NO DEBE HACER NUNCA: guardar el número en estado que sobreviva al envío,
// mandarlo a nuestra API, ni escribirlo en un log. El objeto con los datos se arma, se usa y se
// descarta en la misma función.

/** Lo que devuelve Wompi de la tarjeta, y lo único que es legítimo conservar. */
export type TarjetaTokenizada = {
  token: string
  marca: string
  ultimos4: string
}

export type ResultadoTokenizacion =
  | { ok: true; tarjeta: TarjetaTokenizada }
  | { ok: false; mensaje: string }

/**
 * La URL de Wompi según el prefijo de la llave pública.
 *
 * Se deduce y no se configura aparte por lo mismo que en el servidor: una variable de ambiente que
 * no coincida con las llaves hace que todo parezca funcionar contra el ambiente equivocado.
 */
function baseUrl(llavePublica: string): string | null {
  if (llavePublica.startsWith("pub_test_")) return "https://sandbox.wompi.co/v1"
  if (llavePublica.startsWith("pub_prod_")) return "https://production.wompi.co/v1"
  return null
}

/** Sólo dígitos: los espacios y guiones que la gente escribe rompen la validación de Wompi. */
function soloDigitos(s: string): string {
  return s.replace(/\D/g, "")
}

/**
 * Cambia los datos de la tarjeta por un token de un solo uso.
 *
 * El token vive pocos minutos y sirve para UNA cosa: crear la fuente de pago. No es una tarjeta
 * guardada; eso es lo que devuelve el servidor después.
 */
export async function tokenizarTarjeta(datos: {
  numero: string
  cvc: string
  /** Dos dígitos: "08". */
  mesVencimiento: string
  /** Dos dígitos: "29". */
  anioVencimiento: string
  titular: string
}): Promise<ResultadoTokenizacion> {
  const llavePublica = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY?.trim() ?? ""
  const base = baseUrl(llavePublica)
  if (!base) {
    return { ok: false, mensaje: "Los pagos no están disponibles en este momento." }
  }

  try {
    const res = await fetch(`${base}/tokens/cards`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${llavePublica}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: soloDigitos(datos.numero),
        cvc: soloDigitos(datos.cvc),
        exp_month: datos.mesVencimiento.padStart(2, "0"),
        exp_year: datos.anioVencimiento.slice(-2),
        card_holder: datos.titular.trim(),
      }),
    })

    const json = (await res.json().catch(() => null)) as {
      data?: { id?: string; brand?: string; last_four?: string }
      error?: { messages?: Record<string, string[]>; reason?: string }
    } | null

    if (!res.ok || !json?.data?.id) {
      return { ok: false, mensaje: mensajeDeRechazo(json, res.status) }
    }

    return {
      ok: true,
      tarjeta: {
        token: json.data.id,
        marca: json.data.brand ?? "",
        ultimos4: json.data.last_four ?? "",
      },
    }
  } catch {
    // A propósito NO se registra el error: el objeto de la excepción puede arrastrar el cuerpo de
    // la petición, y el cuerpo de esta petición es una tarjeta.
    return { ok: false, mensaje: "No pudimos validar la tarjeta. Revisá tu conexión e intentá de nuevo." }
  }
}

/**
 * Traduce el rechazo de Wompi a algo que alguien pueda accionar.
 *
 * Wompi responde en inglés y por nombre de campo (`number`, `cvc`, `exp_year`). "number: is
 * invalid" en pantalla no le dice a nadie qué corregir.
 */
function mensajeDeRechazo(
  json: { error?: { messages?: Record<string, string[]>; reason?: string } } | null,
  status: number,
): string {
  const mensajes = json?.error?.messages
  if (mensajes) {
    if (mensajes.number) return "El número de la tarjeta no es válido."
    if (mensajes.cvc) return "El código de seguridad no es válido."
    if (mensajes.exp_month || mensajes.exp_year) return "La fecha de vencimiento no es válida."
    if (mensajes.card_holder) return "El nombre del titular no es válido."
  }
  if (json?.error?.reason) return json.error.reason
  if (status === 401) return "Los pagos no están disponibles en este momento."
  return "No pudimos validar la tarjeta. Revisá los datos e intentá de nuevo."
}

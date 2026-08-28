import "server-only"

// Mandar un aviso de la clínica a sus titulares.
//
// ── EL RIESGO QUE ESTE ARCHIVO ADMINISTRA ─────────────────────────────────────────────────────
//
// El dominio remitente es UNO SOLO PARA TODAS LAS CLÍNICAS. Una lista sucia de una clínica —correos
// viejos que rebotan, gente que marca como spam— le baja la reputación al dominio y manda a la
// carpeta de no deseados los correos de cartera de TODAS las demás. Esa es la razón por la que esto
// estuvo planeado y sin construir desde el 22-ago, y por la que acá hay más frenos que función.
//
//   · Segmentos cerrados: cada dirección viene de algo que pasó en la clínica (ver `audiencia.ts`).
//   · Tope duro por envío.
//   · Ritmo entre correos, y un reintento sólo si el fallo fue transitorio.
//   · La baja se vuelve a comprobar ACÁ, no sólo al armar la lista.
//   · Traza por destinatario, no una del lote.
//
// ── EL PIE DE BAJA NO ES OPCIONAL ─────────────────────────────────────────────────────────────
//
// Va en todos, y con el enlace PROPIO de cada titular. Dos motivos que apuntan al mismo lado: la Ley
// 1581 le da al titular el derecho a revocar, y un correo masivo sin baja visible es el que la gente
// marca como spam — que hace exactamente el daño que este archivo intenta evitar.
//
// ── LO QUE ESTO NO ES ─────────────────────────────────────────────────────────────────────────
//
// No es cobranza y no la reemplaza: darse de baja de los avisos NO da de baja de «tenés una factura
// vencida», que es la relación contractual y tiene su propio régimen (Ley 2300). Por eso el filtro
// vive en `sinLosDeBaja` y no dentro del transporte — si estuviera en el transporte, la primera baja
// apagaría la cobranza de ese titular y nadie lo notaría hasta que faltara la plata.

import { createAdminClient } from "@/lib/supabase/admin"
import { sinLosDeBaja } from "@/lib/email/baja"
import { maquetarCorreo, parrafosDeTexto, type LineaDePie } from "@/lib/email/maqueta"
import { loadClinicSender, sendTransactionalEmail } from "@/lib/email/transactional"
import type { Destinatario } from "./audiencia"

/** Ritmo entre correos. El mismo que ya usa el masivo de plataforma, medido contra el reloj de la función. */
const MS_ENTRE_ENVIOS = 120

export type ResultadoDelAviso = {
  enviados: number
  /** Los que se dieron de baja entre que se armó la lista y se apretó enviar. */
  excluidosPorBaja: number
  fallidos: { email: string; error: string }[]
}

/**
 * El pie, con el enlace propio del titular.
 *
 * Devuelve las líneas del pie de la maqueta y ya no un texto para concatenar al cuerpo. La baja va
 * como `{ texto, url }` A PROPÓSITO: así la maqueta escribe la dirección VISIBLE además de ponerla
 * en el `href`. Un `href` no sobrevive a la derivación del texto plano —quedaría "date de baja acá:"
 * sin dirección—, y para este enlace eso no es una molestia de maquetado: es el derecho de
 * revocación de la Ley 1581 desapareciendo para quien lee el correo en modo texto.
 */
export function pieDeBaja(base: string, token: string): LineaDePie[] {
  const url = `${base.replace(/\/$/, "")}/baja/${token}`
  return [
    "Recibís este aviso porque sos cliente de la clínica.",
    { texto: "Si no querés recibir más avisos, date de baja acá:", url },
    "(Esto no afecta los correos sobre tus facturas.)",
  ]
}

/** Lo que la bandeja muestra al lado del asunto: el arranque del aviso, no el asunto repetido. */
function primerasPalabras(texto: string): string {
  const linea = texto.replace(/\s+/g, " ").trim()
  if (linea.length <= 140) return linea
  return `${linea.slice(0, 139).replace(/\s+\S*$/, "")}…`
}

/**
 * Manda el aviso. Devuelve el recuento; no lanza por un destinatario que falle.
 *
 * SE VUELVE A FILTRAR LA BAJA. Entre que la clínica arma la lista y aprieta enviar pueden pasar diez
 * minutos, y en el medio alguien pudo darse de baja. Filtrar sólo al armar es la forma natural de
 * mandarle correo a quien acaba de pedir que no le mandaran.
 */
export async function enviarAviso(
  clinicId: string,
  userId: string,
  destinatarios: Destinatario[],
  asunto: string,
  cuerpo: string,
  baseUrl: string,
): Promise<ResultadoDelAviso> {
  const admin = createAdminClient()
  const { permitidos } = await sinLosDeBaja(
    clinicId,
    destinatarios.map((d) => d.email),
  )
  const vigentes = new Set(permitidos)
  const aEnviar = destinatarios.filter((d) => vigentes.has(d.email))

  // El remitente se resuelve UNA vez, no por correo: son las mismas dos consultas para todos y en
  // un lote de 500 serían mil viajes de red que no cambian nada.
  const remitente = await loadClinicSender(clinicId)

  const res: ResultadoDelAviso = {
    enviados: 0,
    excluidosPorBaja: destinatarios.length - aEnviar.length,
    fallidos: [],
  }

  // El cuerpo lo escribe la clínica en un textarea: entra a la maqueta como DATO y ella lo escapa.
  // Se parte en párrafos una sola vez — es igual para todos, lo único propio de cada titular es su
  // enlace de baja.
  const parrafos = parrafosDeTexto(cuerpo)
  const preheader = primerasPalabras(parrafos[0] ?? asunto) || asunto

  for (const [i, d] of aEnviar.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, MS_ENTRE_ENVIOS))

    // Se maqueta DENTRO del bucle porque el pie lleva el enlace de baja propio de este titular.
    // Armarlo una sola vez afuera haría que darse de baja diera de baja a otra persona.
    const html = maquetarCorreo({
      titulo: asunto,
      preheader,
      parrafos,
      pie: pieDeBaja(baseUrl, d.token),
    })
    let envio = await sendTransactionalEmail(
      clinicId,
      { to: d.email, subject: asunto, html },
      remitente,
    )
    // Un reintento SÓLO si el fallo fue transitorio. Reintentar un dominio mal configurado es
    // gastar reputación dos veces por el mismo error.
    if (!envio.ok && envio.transient) {
      await new Promise((r) => setTimeout(r, MS_ENTRE_ENVIOS * 2))
      envio = await sendTransactionalEmail(
        clinicId,
        { to: d.email, subject: asunto, html },
        remitente,
      )
    }

    if (envio.ok) res.enviados += 1
    else res.fallidos.push({ email: d.email, error: envio.error ?? "desconocido" })

    // TRAZA POR DESTINATARIO, no una del lote: si algo rebota hay que poder decir a quién le llegó y
    // a quién no, y cuándo. Es lo que convierte un reclamo en algo que se puede responder.
    const { error } = await admin.from("audit_logs").insert({
      clinic_id: clinicId,
      user_id: userId,
      action: "aviso_titulares.enviado",
      payload: {
        to: d.email,
        owner_id: d.ownerId,
        subject: asunto,
        ok: envio.ok,
        error: envio.error ?? null,
      },
    })
    if (error) console.error("aviso a titulares · traza:", error.message)
  }

  return res
}

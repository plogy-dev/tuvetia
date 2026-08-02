import "server-only"

// Remitente de PLATAFORMA — Tuvetia hablándole a SUS usuarios (los veterinarios), no a los clientes
// de una clínica. Lo usa el envío desde /admin/usuarios.
//
// Sale por Resend, igual que el resto del correo transaccional (ver CORREOS.md). Antes iba por un
// SMTP propio (PLATFORM_SMTP_*), que era una tercera forma de mandar correo conviviendo con las
// otras dos: un transporte más que configurar, otra reputación de dominio que cuidar y otro lugar
// donde mirar cuando algo no llega.
//
// Se diferencia del transaccional de `transactional.ts` en una cosa: acá NO va nombre de clínica ni
// Reply-To a sus administradores, porque el destinatario es el veterinario y quien le escribe es
// Tuvetia. Ese es el motivo de que siga siendo un módulo aparte y no un parámetro más.

import { resendApiKey, sendViaResend, type ResendResult } from "./resend"

export type PlatformEmailInput = {
  to: string
  subject: string
  text: string
  html?: string | null
}

/** Remitente de plataforma. Comparte el dominio verificado con el transaccional. */
function platformFrom(): string {
  const address = process.env.TRANSACTIONAL_FROM_EMAIL?.trim() || "vet@tuvetia.com"
  const name = (process.env.PLATFORM_FROM_NAME?.trim() || "Tuvetia").replace(/["\\\r\n]/g, "")
  return `${name} <${address}>`
}

/**
 * ¿Está el remitente de plataforma configurado?
 *
 * El panel lo usa para deshabilitar el botón y explicar por qué, en vez de dejar que el admin
 * escriba el mensaje entero y recién ahí reciba un error.
 */
export const platformEmailConfigurado = () => resendApiKey() !== null

/**
 * Envía un correo de Tuvetia a un usuario de la plataforma.
 *
 * Conserva la clasificación `transient` del transporte: es lo que permite reintentar un envío
 * masivo sin quemar la reputación del dominio reenviando lo que falló por configuración.
 */
export async function sendPlatformEmail(input: PlatformEmailInput): Promise<ResendResult> {
  return sendViaResend({
    from: platformFrom(),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html ?? null,
  })
}

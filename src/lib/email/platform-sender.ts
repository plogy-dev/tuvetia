import "server-only"

// Remitente de PLATAFORMA — el correo que sale de Tuvetia (no de una clínica).
//
// Hasta ahora no existía ninguno. Los dos transportes del repo son:
//   · SMTP POR CLÍNICA (`email/smtp.ts` + `integrations.ts`), con credenciales cifradas por tenant.
//     `sendEmail(creds, input)` ya es agnóstico: no sabe de facturas ni de cartera, sólo envía.
//   · `inviteUserByEmail` de Supabase Auth, que es un martillo de un solo clavo: manda SU plantilla
//     de invitación, no admite asunto ni cuerpo propios, y está fuertemente rate-limited.
//
// Así que el camino de menor fricción es armar el MISMO objeto `EmailCredentials` desde variables
// de entorno y reusar `sendEmail()` sin tocarlo. Cero transporte nuevo, cero criptografía nueva.
//
// Los campos de IMAP van con valores de relleno a propósito: `EmailCredentials` los exige porque la
// integración por clínica también LEE el buzón (para la cobranza), pero el remitente de plataforma
// sólo envía. Nadie los usa en este camino.

import { sendEmail, type SendEmailResult } from "@/lib/email/smtp"
import type { EmailCredentials } from "@/lib/email/integrations"

export type PlatformEmailInput = {
  to: string
  subject: string
  text: string
  html?: string | null
}

/**
 * Credenciales del remitente de plataforma desde el entorno.
 *
 * Devuelve `null` —en vez de lanzar— cuando no están configuradas: el panel tiene que poder decir
 * "falta configurar el correo" en vez de reventar con un 500.
 */
export function loadPlatformEmailCredentials(): EmailCredentials | null {
  const host = process.env.PLATFORM_SMTP_HOST
  const from = process.env.PLATFORM_SMTP_FROM_EMAIL
  const credential = process.env.PLATFORM_SMTP_PASSWORD
  if (!host || !from || !credential) return null

  const port = Number(process.env.PLATFORM_SMTP_PORT ?? 587)
  return {
    id: "platform",
    clinic_id: "platform",
    // El remitente de PLATAFORMA sale de variables de entorno, no de email_integrations: no es de
    // una clínica ni de un miembro.
    user_id: null,
    provider: "smtp",
    from_email: from,
    from_name: process.env.PLATFORM_SMTP_FROM_NAME ?? "Tuvetia",
    smtp_host: host,
    smtp_port: port,
    // 465 = TLS implícito; 587 = STARTTLS (nodemailer lo negocia solo). Misma regla que por clínica.
    smtp_secure: (process.env.PLATFORM_SMTP_SECURE ?? String(port === 465)) === "true",
    imap_host: "",
    imap_port: 993,
    imap_mailbox: "INBOX",
    status: "connected",
    last_error: null,
    verified_at: null,
    connected_at: null,
    credential,
  }
}

/** ¿Está el remitente de plataforma configurado? Para que la UI lo diga antes de intentar enviar. */
export const platformEmailConfigurado = () => loadPlatformEmailCredentials() !== null

/**
 * Envía un correo desde la plataforma. Reusa `sendEmail()` tal cual — incluida su clasificación de
 * fallos transitorios vs permanentes, que es lo que permitirá reintentar el envío masivo sin
 * quemar la reputación del dominio.
 */
export async function sendPlatformEmail(input: PlatformEmailInput): Promise<SendEmailResult> {
  const creds = loadPlatformEmailCredentials()
  if (!creds) {
    return {
      ok: false,
      messageId: null,
      error:
        "El correo de plataforma no está configurado. Faltan PLATFORM_SMTP_HOST, PLATFORM_SMTP_FROM_EMAIL y/o PLATFORM_SMTP_PASSWORD.",
      transient: false,
    }
  }
  // Message-ID propio, como en el resto del repo: es la raíz del hilo y lo que permite reconocer
  // una respuesta. El dominio sale del remitente para que no lo marque ningún filtro.
  const dominio = creds.from_email.split("@")[1] ?? "tuvetia.com"
  const messageId = `<plataforma-${crypto.randomUUID()}@${dominio}>`
  return sendEmail(creds, { ...input, messageId })
}

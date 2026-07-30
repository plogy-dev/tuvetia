import "server-only"

// Transporte SMTP (nodemailer). Envía y punto: no sabe de facturas, de cartera ni de Supabase.
// Quien lo llama arma el contenido y decide qué registrar — igual que sendWhatsAppText.
//
// Por qué SMTP y no la API de Gmail: leer el buzón por API exige un scope RESTRINGIDO de Google
// (verificación + auditoría CASA, meses). Las App Passwords están exceptuadas del requisito de
// OAuth y sirven para SMTP e IMAP, así que con una credencial tenemos enviar Y leer sin trámite.
// Ver el encabezado de la migración 0039.

import nodemailer from "nodemailer"

import type { EmailCredentials } from "./integrations"

export interface SendEmailInput {
  to: string
  subject: string
  /** Cuerpo en texto plano. */
  text: string
  /** Cuerpo HTML opcional; si va, se manda multipart y el cliente elige. */
  html?: string | null
  /** Message-ID propio: es la raíz del hilo y lo que permite reconocer las respuestas. */
  messageId: string
  inReplyTo?: string | null
  references?: string | null
}

export interface SendEmailResult {
  ok: boolean
  messageId: string | null
  error?: string
  /**
   * true si el fallo es TRANSITORIO (red, rate limit del proveedor, timeout) y no estructural
   * (credencial rechazada, destinatario inválido). El motor de cartera reprograma los transitorios
   * en vez de marcar el recordatorio como OMITIDO y perderlo — misma semántica que el puerto de
   * WhatsApp.
   */
  transient?: boolean
}

/** Timeouts explícitos: sin esto un SMTP colgado se come el tiempo de la función serverless. */
const TIMEOUT_MS = 20_000

function transportFor(creds: EmailCredentials) {
  return nodemailer.createTransport({
    host: creds.smtp_host,
    port: creds.smtp_port,
    // true = TLS implícito (465). false = STARTTLS (587). Nodemailer negocia STARTTLS solo.
    secure: creds.smtp_secure,
    auth: { user: creds.from_email, pass: creds.credential },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })
}

/**
 * Códigos de fallo que NO se arreglan reintentando: la credencial está mal o el destinatario no
 * existe. Todo lo demás (red, 4xx del servidor, timeout) se trata como transitorio.
 *
 * 535 = credenciales rechazadas — el caso típico cuando el admin de Workspace desactiva las App
 * Passwords. 550/553 = destinatario inexistente o rechazado.
 */
const PERMANENT_CODES = new Set([535, 550, 553, 554])

function classify(err: unknown): { message: string; transient: boolean } {
  const e = err as { message?: string; responseCode?: number; code?: string }
  const message = e?.message ?? "Error desconocido al enviar el correo"
  if (typeof e?.responseCode === "number" && PERMANENT_CODES.has(e.responseCode)) {
    return { message, transient: false }
  }
  // EAUTH de nodemailer = autenticación rechazada, aunque no traiga responseCode.
  if (e?.code === "EAUTH") return { message, transient: false }
  return { message, transient: true }
}

export async function sendEmail(
  creds: EmailCredentials,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  try {
    const info = await transportFor(creds).sendMail({
      from: creds.from_name ? { name: creds.from_name, address: creds.from_email } : creds.from_email,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      // Se fija el Message-ID nuestro en vez de dejar que nodemailer genere uno: es la raíz del
      // hilo y tiene que coincidir con lo que guardamos en invoice_email_threads.
      messageId: input.messageId,
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
      ...(input.references ? { references: input.references } : {}),
    })
    return { ok: true, messageId: info.messageId ?? input.messageId }
  } catch (err) {
    const { message, transient } = classify(err)
    console.error(`[email/smtp] fallo enviando a ${input.to}:`, message)
    return { ok: false, messageId: null, error: message, transient }
  }
}

/**
 * Handshake sin enviar nada: valida host, puerto y credencial.
 *
 * Es lo que permite no marcar la integración como 'connected' hasta saber que de verdad funciona.
 * Sin esto, el vet configuraría el correo, vería "conectado", y se enteraría del problema cuando un
 * cliente no recibe la factura.
 */
export async function verifySmtp(creds: EmailCredentials): Promise<{ ok: boolean; error?: string }> {
  try {
    await transportFor(creds).verify()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: classify(err).message }
  }
}

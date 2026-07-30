import "server-only"

// Credenciales de correo por clínica. Corre con el ADMIN client (service_role) porque la columna
// `credential_enc` está revocada para PostgREST, así que la sesión del vet no puede leerla ni con
// RLS a favor. Por eso TODO query filtra explícito por clinic_id — service_role se salta la RLS y
// esa es la regla dura del repo (athos-service/CLAUDE.md §7).

import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret, encryptSecret } from "@/lib/crypto"

export type EmailProvider = "smtp" | "gmail_oauth" | "outlook_oauth"
export type EmailStatus = "pending" | "connected" | "error" | "disconnected"

/** Fila tal como vive en la BD, sin la credencial. */
export interface EmailIntegrationRow {
  id: string
  clinic_id: string
  provider: EmailProvider
  from_email: string
  from_name: string | null
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  imap_host: string
  imap_port: number
  imap_mailbox: string
  status: EmailStatus
  last_error: string | null
  verified_at: string | null
  connected_at: string | null
}

/** Lo que necesitan los transportes: la fila + la credencial ya descifrada. */
export interface EmailCredentials extends EmailIntegrationRow {
  credential: string
}

const COLUMNS =
  "id, clinic_id, provider, from_email, from_name, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_mailbox, status, last_error, verified_at, connected_at"

/** Estado de la integración para la UI. Nunca incluye la credencial. */
export async function getEmailIntegration(clinicId: string): Promise<EmailIntegrationRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("email_integrations")
    .select(COLUMNS)
    .eq("clinic_id", clinicId)
    .maybeSingle()
  return (data as EmailIntegrationRow | null) ?? null
}

/**
 * Integración lista para enviar/leer: exige status='connected' Y credencial presente.
 *
 * Devuelve null en vez de lanzar: los callers son el motor de cartera y el envío de facturas, y
 * "la clínica no tiene correo configurado" es un estado NORMAL, no un error. Lanzar acá haría que
 * un barrido de cartera se cayera entero por una clínica sin correo.
 */
export async function loadEmailCredentials(clinicId: string): Promise<EmailCredentials | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("email_integrations")
    .select(`${COLUMNS}, credential_enc`)
    .eq("clinic_id", clinicId)
    .maybeSingle()
  const row = data as (EmailIntegrationRow & { credential_enc: string | null }) | null
  if (!row || row.status !== "connected" || !row.credential_enc) return null
  try {
    const { credential_enc, ...rest } = row
    return { ...rest, credential: decryptSecret(credential_enc) }
  } catch (e) {
    // Credencial ilegible = llave rotada sin re-cifrar, o fila corrupta. Se reporta y se trata como
    // "sin correo" para no tumbar al caller; el vet ve el motivo en Configuración.
    console.error(`[email/integrations] credencial ilegible para clinic=${clinicId}:`, e)
    await markError(clinicId, "La credencial guardada no se pudo descifrar. Reconectá el correo.")
    return null
  }
}

export interface SaveEmailIntegrationInput {
  clinicId: string
  userId: string | null
  fromEmail: string
  fromName?: string | null
  /** App Password de Gmail (o del proveedor SMTP). Se cifra antes de guardar. */
  credential: string
  smtpHost?: string
  smtpPort?: number
  smtpSecure?: boolean
  imapHost?: string
  imapPort?: number
  imapMailbox?: string
}

/**
 * Guarda la integración en estado 'pending'. El paso de verificación es el que la pasa a
 * 'connected' — nunca se marca conectada sin haber hecho el handshake, porque un correo que no sale
 * es un fallo silencioso y el vet creería que está andando.
 */
export async function saveEmailIntegration(input: SaveEmailIntegrationInput): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from("email_integrations").upsert(
    {
      clinic_id: input.clinicId,
      created_by: input.userId,
      provider: "smtp" as EmailProvider,
      from_email: input.fromEmail.trim().toLowerCase(),
      from_name: input.fromName?.trim() || null,
      credential_enc: encryptSecret(input.credential),
      ...(input.smtpHost ? { smtp_host: input.smtpHost } : {}),
      ...(input.smtpPort ? { smtp_port: input.smtpPort } : {}),
      ...(input.smtpSecure !== undefined ? { smtp_secure: input.smtpSecure } : {}),
      ...(input.imapHost ? { imap_host: input.imapHost } : {}),
      ...(input.imapPort ? { imap_port: input.imapPort } : {}),
      ...(input.imapMailbox ? { imap_mailbox: input.imapMailbox } : {}),
      status: "pending" as EmailStatus,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id" },
  )
  if (error) throw new Error(`No se pudo guardar la integración de correo: ${error.message}`)
}

export async function markConnected(clinicId: string): Promise<void> {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  await admin
    .from("email_integrations")
    .update({ status: "connected", last_error: null, verified_at: now, connected_at: now, updated_at: now })
    .eq("clinic_id", clinicId)
}

/**
 * Marca el fallo con su motivo. Se guarda el mensaje para que Configuración muestre algo accionable
 * ("contraseña rechazada", "IMAP deshabilitado") en vez de un "no se pudo enviar" mudo.
 */
export async function markError(clinicId: string, reason: string): Promise<void> {
  const admin = createAdminClient()
  await admin
    .from("email_integrations")
    .update({ status: "error", last_error: reason.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("clinic_id", clinicId)
}

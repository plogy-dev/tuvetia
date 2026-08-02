import "server-only"

// Correo TRANSACCIONAL de Tuvetia: facturas, recordatorios de cobranza y, de acá en más, cualquier
// notificación que la plataforma le mande a un cliente en nombre de una clínica.
//
// La regla, en una línea: **sale de vet@tuvetia.com, firmado con el nombre de la clínica, y el
// Reply-To apunta a los administradores de esa clínica.** Ver CORREOS.md para el porqué de cada
// pieza y para cómo agregar un correo nuevo sin romper la regla.
//
//   From:     "Clínica de Santiago Tellez <vet@tuvetia.com>"
//   Reply-To:  admin@laclinica.com
//
// Por qué NO sale de la cuenta de la clínica, que es como estaba: entregabilidad. Un dominio con
// SPF/DKIM propios y reputación cuidada (tuvetia.com) llega a la bandeja; una cuenta de Gmail
// mandando facturas por SMTP termina en spam apenas sube el volumen, y ahí el cliente no se entera
// de que le cobraron. Además, no depender de que cada clínica configure SMTP hace que facturar
// funcione desde el primer día.
//
// El Reply-To es lo que evita el efecto secundario obvio: el cliente responde y le llega a SU
// veterinaria, no a Tuvetia.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import { sendViaResend, type ResendResult } from "./resend"

/** Remitente único de todo lo transaccional. Configurable, pero con un default explícito. */
export function transactionalFrom(): string {
  return process.env.TRANSACTIONAL_FROM_EMAIL?.trim() || "vet@tuvetia.com"
}

export interface TransactionalInput {
  to: string
  subject: string
  text: string
  html?: string | null
  /** Message-ID propio: la raíz del hilo, para reconocer después la respuesta del cliente. */
  messageId?: string | null
}

export interface ClinicSender {
  /** Nombre que ve el destinatario: el de la clínica, no "Tuvetia". */
  displayName: string
  /** Correos de los administradores, para el Reply-To. */
  replyTo: string[]
}

/**
 * Quién firma y a quién se le responde, para una clínica.
 *
 * `displayName` sale de `clinics.name`. El Reply-To son los correos de los administradores
 * (`profiles.role = 'admin'`), leídos de `auth.users` — plural a propósito: una clínica puede tener
 * más de un admin y no hay motivo para elegir uno.
 *
 * Si no hay ningún admin con correo (no debería pasar), se devuelve `replyTo` vacío y el correo sale
 * igual: perder el Reply-To es molesto, no mandar la factura es peor.
 */
export async function loadClinicSender(
  clinicId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<ClinicSender> {
  const { data: clinica } = await admin
    .from("clinics")
    .select("name")
    .eq("id", clinicId)
    .maybeSingle()
  const displayName = (clinica as { name: string } | null)?.name?.trim() || "Tuvetia"

  const { data: perfiles } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("role", "admin")
  const ids = ((perfiles ?? []) as { id: string }[]).map((p) => p.id)

  const replyTo: string[] = []
  for (const id of ids) {
    // El correo vive en auth.users, que PostgREST no expone: se pide por la Admin API.
    const { data } = await admin.auth.admin.getUserById(id)
    const email = data.user?.email?.trim()
    if (email) replyTo.push(email)
  }

  return { displayName, replyTo }
}

/** Escapa el nombre para el header `From`: unas comillas sueltas rompen la dirección. */
function fromHeader(displayName: string, address: string): string {
  const limpio = displayName.replace(/["\\\r\n]/g, "").trim()
  return limpio ? `${limpio} <${address}>` : address
}

/**
 * Manda un correo transaccional EN NOMBRE de una clínica.
 *
 * Es el único camino para este tipo de correo: si mañana se agrega "recordatorio de vacuna" o
 * "resultado de laboratorio", entra por acá y hereda remitente y Reply-To sin volver a decidirlo.
 */
export async function sendTransactionalEmail(
  clinicId: string,
  input: TransactionalInput,
  sender?: ClinicSender,
): Promise<ResendResult> {
  const quien = sender ?? (await loadClinicSender(clinicId))
  return sendViaResend({
    from: fromHeader(quien.displayName, transactionalFrom()),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html ?? null,
    replyTo: quien.replyTo.length > 0 ? quien.replyTo : null,
    // Resend genera su propio Message-ID si no se fija uno. Se fija el nuestro porque es la raíz
    // del hilo que después permite atribuir la respuesta del cliente a esta factura.
    ...(input.messageId ? { headers: { "Message-ID": input.messageId } } : {}),
  })
}

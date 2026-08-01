import "server-only"

// Barrido de respuestas por correo — la contraparte IMAP de cartera/wa-router.
//
// El correo no tiene webhook: un barrido (desde el cron de cartera) trae los mensajes nuevos del
// buzón, los atribuye a su factura por los headers de hilado (In-Reply-To/References contra el
// root_message_id guardado en invoice_email_threads) y los enruta al MISMO motor de intents que
// WhatsApp — executeCarteraInbound con channel='EMAIL'. Adjuntos → comprobantes en el bucket
// privado + tarea de verificación. La respuesta (si el intent la tiene) sale EN EL MISMO HILO.
//
// Cursor: last_seen_uid por hilo; el barrido usa max() por clínica. Es seguro porque los mensajes
// se procesan en orden ASCENDENTE de UID: si el barrido muere a mitad, el próximo retoma desde el
// último procesado — reprocesa a lo sumo una ventana pequeña, jamás saltea. (Ese reproceso raro
// puede duplicar una fila de comm_messages; es visible y preferible a perder una respuesta.)
//
// Todo con service_role y clinic_id EXPLÍCITO en cada query — regla dura del repo.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import { classifyCarteraIntent, executeCarteraInbound } from "@/lib/cartera/inbound"
import { storeReceipt } from "@/lib/cartera/receipts"
import { bogotaTodayISO } from "@/lib/date-utils"
import { loadEmailCredentials, markError, type EmailCredentials } from "./integrations"
import { fetchNewMessages, type InboundEmail } from "./imap"
import { sendEmail } from "./smtp"
import { belongsToThread, replyHeaders, replySubject } from "./threading"

interface ThreadRow {
  id: string
  invoice_id: string
  root_message_id: string
  subject: string | null
  to_email: string
  last_seen_uid: number | null
}

interface InvoiceRow {
  id: string
  full_number: string | null
  share_token: string
  balance_cents: number
  status: string
  followup_enabled: boolean
  payer_id: string | null
}

export interface EmailSyncResult {
  clinicId: string
  fetched: number
  matched: number
  replied: number
  receipts: number
}

export async function syncEmailRepliesForClinic(clinicId: string): Promise<EmailSyncResult> {
  const result: EmailSyncResult = { clinicId, fetched: 0, matched: 0, replied: 0, receipts: 0 }
  const admin = createAdminClient()

  const creds = await loadEmailCredentials(clinicId)
  if (!creds) return result // sin correo conectado: estado normal, no un error

  // Hilos de la clínica. Se traen todos y se filtra por factura cobrable después: un hilo de
  // factura ya pagada igual avanza su cursor, para que el buzón no se relea eternamente.
  const { data: threadRows } = await admin
    .from("invoice_email_threads")
    .select("id, invoice_id, root_message_id, subject, to_email, last_seen_uid")
    .eq("clinic_id", clinicId)
  const threads = (threadRows ?? []) as ThreadRow[]
  if (threads.length === 0) return result

  const cursor = threads.reduce<number | null>(
    (max, t) => (t.last_seen_uid !== null && (max === null || t.last_seen_uid > max) ? t.last_seen_uid : max),
    null,
  )

  let messages: InboundEmail[]
  try {
    messages = await fetchNewMessages(creds, cursor)
  } catch (e) {
    // IMAP caído o credencial revocada: se marca para que Configuración lo muestre, y el barrido
    // de las demás clínicas sigue. La credencial rechazada acá es cómo nos enteramos de que un
    // admin de Workspace desactivó las App Passwords (plan B en ESTADO.md → backlog Opción A).
    const msg = (e as Error).message ?? "No se pudo leer el buzón"
    if (/auth|login|credentials|invalid/i.test(msg)) {
      await markError(clinicId, `IMAP rechazó la conexión: ${msg}`)
    }
    console.error(`[email/sync] clinic=${clinicId} fallo leyendo el buzón:`, msg)
    return result
  }
  result.fetched = messages.length
  if (messages.length === 0) return result

  for (const msg of messages) {
    // Nunca procesar lo que nosotros mismos enviamos (respuestas propias copiadas al buzón).
    if (msg.fromEmail && msg.fromEmail === creds.from_email) {
      await advanceCursors(admin, clinicId, threads, msg.uid)
      continue
    }

    const thread = threads.find((t) =>
      belongsToThread(t.root_message_id, { references: msg.references, inReplyTo: msg.inReplyTo }),
    )
    if (!thread) {
      // Correo ajeno a Tuvetia (el buzón puede ser el de la clínica para todo). No es nuestro:
      // solo avanza el cursor para no re-leerlo.
      await advanceCursors(admin, clinicId, threads, msg.uid)
      continue
    }
    result.matched += 1

    await processThreadMessage(admin, clinicId, creds, thread, msg, result)

    // El cursor del hilo avanza SIEMPRE, incluso si el procesamiento falló a medias: preferimos
    // una respuesta perdida visible en la tarea humana a un buzón que se reprocesa en loop.
    await admin
      .from("invoice_email_threads")
      .update({
        last_seen_uid: msg.uid,
        last_inbound_at: (msg.date ?? new Date()).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", thread.id)
      .eq("clinic_id", clinicId)
    thread.last_seen_uid = msg.uid
  }

  return result
}

async function processThreadMessage(
  admin: SupabaseClient,
  clinicId: string,
  creds: EmailCredentials,
  thread: ThreadRow,
  msg: InboundEmail,
  result: EmailSyncResult,
): Promise<void> {
  try {
    // La factura debe seguir cobrable — mismo criterio que wa-router.
    const { data: invRow } = await admin
      .from("invoices")
      .select("id, full_number, share_token, balance_cents, status, followup_enabled, payer_id")
      .eq("clinic_id", clinicId)
      .eq("id", thread.invoice_id)
      .maybeSingle()
    const invoice = invRow as InvoiceRow | null
    if (!invoice || invoice.status !== "EMITIDA" || invoice.balance_cents <= 0 || !invoice.followup_enabled) {
      return
    }

    // owner: por el pagador de la factura (billing_payers.owner_id) — el correo no trae teléfono.
    let ownerId: string | null = null
    if (invoice.payer_id) {
      const { data: payer } = await admin
        .from("billing_payers")
        .select("owner_id")
        .eq("clinic_id", clinicId)
        .eq("id", invoice.payer_id)
        .maybeSingle()
      ownerId = (payer as { owner_id: string | null } | null)?.owner_id ?? null
    }

    const hasAttachments = msg.attachments.length > 0
    const text = msg.text || (hasAttachments ? "(el cliente envió un archivo adjunto, probablemente un comprobante)" : "")
    if (!text && !hasAttachments) return

    const classification = await classifyCarteraIntent(text, {
      todayISO: bogotaTodayISO(),
      clinicId,
    })

    const inbound = await executeCarteraInbound(admin, clinicId, {
      channel: "EMAIL",
      ownerId: ownerId ?? "",
      invoiceId: invoice.id,
      invoiceNumber: invoice.full_number ?? "",
      shareToken: invoice.share_token,
      incomingText: text,
      classification,
      waConversationId: null,
    })

    // Adjuntos → comprobantes (bytes al bucket privado + tarea de verificación).
    for (const att of msg.attachments) {
      try {
        await storeReceipt(admin, clinicId, {
          invoiceId: invoice.id,
          invoiceNumber: invoice.full_number ?? "",
          ownerId,
          commMessageId: inbound.commMessageId,
          filename: att.filename,
          contentType: att.contentType,
          bytes: att.bytes,
        })
        result.receipts += 1
      } catch (e) {
        console.error(`[email/sync] comprobante no guardado (${att.filename}):`, e)
      }
    }

    // Respuesta del catálogo de intents, EN EL MISMO HILO (In-Reply-To/References + un solo Re:).
    if (inbound.reply) {
      const headers = replyHeaders(thread.root_message_id, msg.references)
      const sent = await sendEmail(creds, {
        to: msg.fromEmail ?? thread.to_email,
        subject: replySubject(thread.subject),
        text: inbound.reply,
        messageId: `<r.${thread.id}.${msg.uid}@${creds.from_email.split("@")[1] ?? "tuvetia.com"}>`,
        inReplyTo: headers.inReplyTo,
        references: headers.references,
      })
      if (sent.ok) result.replied += 1
    }
  } catch (e) {
    // Un mensaje que no se pudo procesar no debe frenar el barrido del buzón.
    console.error(`[email/sync] clinic=${clinicId} uid=${msg.uid} fallo procesando:`, e)
  }
}

/**
 * Un mensaje ajeno o propio igual mueve el cursor de TODOS los hilos que estén detrás: si no, el
 * max() de la clínica queda clavado y ese correo se re-lee en cada barrido para siempre.
 */
async function advanceCursors(
  admin: SupabaseClient,
  clinicId: string,
  threads: ThreadRow[],
  uid: number,
): Promise<void> {
  const behind = threads.filter((t) => (t.last_seen_uid ?? 0) < uid)
  for (const t of behind) t.last_seen_uid = uid
  if (behind.length === 0) return
  await admin
    .from("invoice_email_threads")
    .update({ last_seen_uid: uid, updated_at: new Date().toISOString() })
    .eq("clinic_id", clinicId)
    .in(
      "id",
      behind.map((t) => t.id),
    )
}

/** Todas las clínicas con correo conectado. Lo llama el cron de cartera (piggyback: Hobby = 2 crons y los 2 cupos están usados). */
export async function syncEmailRepliesForAllClinics(): Promise<{
  clinics: number
  fetched: number
  matched: number
  replied: number
  receipts: number
}> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("email_integrations")
    .select("clinic_id")
    .eq("status", "connected")
  const clinicIds = ((data ?? []) as { clinic_id: string }[]).map((r) => r.clinic_id)

  const totals = { clinics: clinicIds.length, fetched: 0, matched: 0, replied: 0, receipts: 0 }
  for (const clinicId of clinicIds) {
    try {
      const r = await syncEmailRepliesForClinic(clinicId)
      totals.fetched += r.fetched
      totals.matched += r.matched
      totals.replied += r.replied
      totals.receipts += r.receipts
    } catch (e) {
      // Una clínica que falle no frena a las demás — misma doctrina que runCarteraForAllClinics.
      console.error(`[email/sync] clinic=${clinicId} barrido fallido:`, e)
    }
  }
  return totals
}

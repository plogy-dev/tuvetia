import "server-only"

// Bandeja de correo de la clínica: baja el buzón y lo GUARDA entero (email_threads /
// email_messages, migración 0050). Es lo que hace posible ver el correo en la app y que Athos lo
// lea; antes el barrido leía el INBOX y descartaba todo lo que no fuera respuesta a una factura.
//
// POR QUÉ ES UN BARRIDO APARTE Y NO UN AÑADIDO A sync.ts. El barrido de sync.ts alimenta la
// cobranza: clasifica intenciones, responde solo, guarda comprobantes y crea tareas. Funciona, y en
// todo `src/lib/email/__tests__/` solo hay pruebas de las funciones puras de threading — nada
// cubre ese flujo. Meterle mano al cursor y a la iteración para reusar la misma pasada habría
// puesto en riesgo facturación a cambio de ahorrar una conexión IMAP. Este archivo tiene su propio
// cursor (email_integrations.inbox_last_uid) y no toca nada de cartera.
//
// Idempotente por `message_id` (unique con clinic_id): reprocesar una ventana no duplica. Eso
// importa porque el cursor avanza al final del lote, así que un fallo a mitad relee lo ya visto.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import { loadEmailCredentials, markError } from "./integrations"
import { fetchNewMessages, type InboundEmail } from "./imap"
import { parseMessageIds } from "./threading"

export interface InboxSyncResult {
  clinicId: string
  fetched: number
  stored: number
}

/** Primeras líneas para la lista de la bandeja, sin arrastrar el cuerpo entero. */
const SNIPPET_MAX = 180

function snippetOf(text: string): string {
  const plano = text.replace(/\s+/g, " ").trim()
  return plano.length > SNIPPET_MAX ? `${plano.slice(0, SNIPPET_MAX - 1)}…` : plano
}

function normalizar(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase()
}

/**
 * A qué hilo pertenece el mensaje.
 *
 * Se buscan los ids de In-Reply-To/References contra los mensajes YA guardados: si alguno está,
 * el hilo es el suyo. Esto encadena bien las respuestas largas — el tercer mensaje referencia al
 * segundo, que ya conocemos — sin depender de que la raíz siga en el header (algunos clientes la
 * pierden al recortar References).
 *
 * Si no matchea nada, el mensaje ABRE hilo y su propio Message-ID es la raíz.
 */
async function resolverHilo(
  admin: SupabaseClient,
  clinicId: string,
  msg: InboundEmail,
): Promise<{ threadId: string; esNuevo: boolean } | null> {
  const referenciados = [
    ...parseMessageIds(msg.inReplyTo),
    ...parseMessageIds(msg.references),
  ].map((id) => id.trim())

  if (referenciados.length > 0) {
    const { data } = await admin
      .from("email_messages")
      .select("thread_id")
      .eq("clinic_id", clinicId)
      .in("message_id", referenciados)
      .limit(1)
    const hit = (data ?? [])[0] as { thread_id: string } | undefined
    if (hit) return { threadId: hit.thread_id, esNuevo: false }
  }

  // Hilo nuevo. La raíz es el id del propio mensaje; sin Message-ID no hay forma de identificarlo
  // después (ni de deduplicarlo), así que se descarta — es un correo malformado.
  const raiz = msg.messageId?.trim()
  if (!raiz) return null

  const { data: creado, error } = await admin
    .from("email_threads")
    .upsert(
      {
        clinic_id: clinicId,
        root_message_id: raiz,
        subject: msg.subject ?? null,
        participants: [normalizar(msg.fromEmail)].filter(Boolean),
        last_message_at: (msg.date ?? new Date()).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id,root_message_id" },
    )
    .select("id")
    .single()
  if (error || !creado) {
    console.error(`[email/inbox] no se pudo abrir el hilo (${raiz}):`, error?.message)
    return null
  }
  return { threadId: (creado as { id: string }).id, esNuevo: true }
}

/**
 * Ata el hilo a un titular si alguna dirección coincide con owners.email.
 *
 * Es lo que permite mostrar "hilo de Ana Restrepo" y que Athos relacione un correo con un paciente.
 * Solo se hace una vez por hilo (si ya tiene owner, no se toca): el titular no cambia.
 */
async function vincularTitular(
  admin: SupabaseClient,
  clinicId: string,
  threadId: string,
  direcciones: string[],
): Promise<void> {
  const candidatas = direcciones.map(normalizar).filter(Boolean)
  if (candidatas.length === 0) return

  const { data: hilo } = await admin
    .from("email_threads")
    .select("owner_id")
    .eq("id", threadId)
    .maybeSingle()
  if ((hilo as { owner_id: string | null } | null)?.owner_id) return

  const { data: owner } = await admin
    .from("owners")
    .select("id")
    .eq("clinic_id", clinicId)
    .in("email", candidatas)
    .limit(1)
    .maybeSingle()
  const ownerId = (owner as { id: string } | null)?.id
  if (ownerId) {
    await admin.from("email_threads").update({ owner_id: ownerId }).eq("id", threadId)
  }
}

/** Baja y guarda el buzón de una clínica. Nunca lanza: un fallo no puede cortar el barrido global. */
export async function syncInboxForClinic(clinicId: string): Promise<InboxSyncResult> {
  const result: InboxSyncResult = { clinicId, fetched: 0, stored: 0 }
  const admin = createAdminClient()

  const creds = await loadEmailCredentials(clinicId)
  if (!creds) return result // sin correo conectado: estado normal, no un error

  const { data: integ } = await admin
    .from("email_integrations")
    .select("inbox_last_uid")
    .eq("clinic_id", clinicId)
    .maybeSingle()
  const cursor = (integ as { inbox_last_uid: number | null } | null)?.inbox_last_uid ?? null

  let messages: InboundEmail[]
  try {
    messages = await fetchNewMessages(creds, cursor)
  } catch (e) {
    // Mismo criterio que sync.ts: una credencial rechazada se marca para que Conexiones lo muestre
    // (así nos enteramos si un admin de Workspace desactivó las App Passwords), y el barrido de las
    // demás clínicas sigue.
    const msg = (e as Error).message ?? "No se pudo leer el buzón"
    if (/auth|login|credentials|invalid/i.test(msg)) {
      await markError(clinicId, `IMAP rechazó la conexión: ${msg}`)
    }
    console.error(`[email/inbox] clinic=${clinicId} fallo leyendo el buzón:`, msg)
    return result
  }

  result.fetched = messages.length
  if (messages.length === 0) return result

  let maxUid = cursor ?? 0
  for (const msg of messages) {
    if (msg.uid > maxUid) maxUid = msg.uid
    if (!msg.messageId) continue // sin Message-ID no se puede deduplicar ni hilar

    try {
      const hilo = await resolverHilo(admin, clinicId, msg)
      if (!hilo) continue

      // Lo que sale de esta cuenta es nuestro; el resto es entrante. Gmail copia los enviados al
      // buzón, así que sin esto un correo propio aparecería como si lo hubiera mandado el titular.
      const esPropio = normalizar(msg.fromEmail) === normalizar(creds.from_email)
      const fecha = (msg.date ?? new Date()).toISOString()

      const { error: insErr } = await admin.from("email_messages").upsert(
        {
          clinic_id: clinicId,
          thread_id: hilo.threadId,
          message_id: msg.messageId,
          in_reply_to: msg.inReplyTo,
          references_raw: msg.references,
          direction: esPropio ? "outbound" : "inbound",
          from_email: normalizar(msg.fromEmail) || "(desconocido)",
          to_emails: [normalizar(creds.from_email)].filter(Boolean),
          subject: msg.subject ?? null,
          body_text: msg.text || null,
          snippet: snippetOf(msg.text || ""),
          // Solo metadata: los bytes no se guardan (ver 0050).
          attachments: msg.attachments.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            bytes: a.bytes.length,
          })),
          imap_uid: msg.uid,
          created_at: fecha,
        },
        { onConflict: "clinic_id,message_id", ignoreDuplicates: true },
      )
      if (insErr) {
        console.error(`[email/inbox] no se pudo guardar ${msg.messageId}:`, insErr.message)
        continue
      }
      result.stored += 1

      await vincularTitular(admin, clinicId, hilo.threadId, [msg.fromEmail ?? ""])

      // El hilo se ordena por su último mensaje, y los entrantes suman al contador de no leídos.
      const patch: Record<string, unknown> = { last_message_at: fecha, updated_at: new Date().toISOString() }
      await admin.from("email_threads").update(patch).eq("id", hilo.threadId).lte("last_message_at", fecha)
      if (!esPropio) {
        await admin.rpc("increment_email_thread_unread", { p_thread_id: hilo.threadId })
      }
    } catch (e) {
      // Un mensaje roto no puede frenar el resto del lote.
      console.error(`[email/inbox] mensaje ${msg.messageId} falló:`, e)
    }
  }

  // El cursor avanza al final: si el proceso muere a mitad, la próxima corrida relee la ventana y
  // la deduplicación por message_id evita duplicados. Se prefiere releer a saltear.
  if (maxUid > (cursor ?? 0)) {
    await admin
      .from("email_integrations")
      .update({ inbox_last_uid: maxUid })
      .eq("clinic_id", clinicId)
  }

  return result
}

/** Barrido de todas las clínicas con correo conectado. Lo llama el cron. */
export async function syncInboxForAllClinics(): Promise<InboxSyncResult[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("email_integrations")
    .select("clinic_id")
    .eq("status", "connected")
  const clinics = ((data ?? []) as { clinic_id: string }[]).map((r) => r.clinic_id)

  const out: InboxSyncResult[] = []
  for (const clinicId of clinics) {
    out.push(await syncInboxForClinic(clinicId))
  }
  return out
}

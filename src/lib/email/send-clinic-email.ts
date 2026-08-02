import "server-only"

// El ÚNICO camino de salida de correo de la bandeja — mismo rol que `sendWhatsAppText` para
// WhatsApp: envía por SMTP y deja el rastro en `email_messages`, para que lo enviado aparezca en el
// hilo al lado de lo recibido en vez de desaparecer.
//
// No lo usa la cobranza: esa manda sus facturas por su propio camino (`sync.ts` + `smtp.ts`
// directo) y guarda en `comm_messages`/`invoice_email_threads`. Son dos registros distintos a
// propósito — uno es la conversación, el otro la trazabilidad de cobro.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import { loadEmailCredentials } from "./integrations"
import { sendEmail } from "./smtp"
import { buildMessageId, replyHeaders, replySubject } from "./threading"

export interface SendClinicEmailResult {
  messageId: string
  threadId: string
  /** El correo salió pero no se pudo registrar: el vet tiene que saberlo. */
  warning?: string
}

type ThreadRow = {
  id: string
  root_message_id: string
  subject: string | null
}

function snippetOf(text: string): string {
  const plano = text.replace(/\s+/g, " ").trim()
  return plano.length > 180 ? `${plano.slice(0, 179)}…` : plano
}

/** References del último mensaje del hilo, para encadenar la respuesta donde corresponde. */
async function ultimasReferencias(
  admin: SupabaseClient,
  threadId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("email_messages")
    .select("message_id, references_raw")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(1)
  const ultimo = (data ?? [])[0] as { message_id: string; references_raw: string | null } | undefined
  if (!ultimo) return null
  // La cadena del último + él mismo: así el In-Reply-To apunta al mensaje real que se responde.
  return [ultimo.references_raw, ultimo.message_id].filter(Boolean).join(" ")
}

/**
 * Envía un correo de la clínica.
 *
 * Con `threadId` responde DENTRO de ese hilo (asunto `Re:` y headers de hilado); sin él abre uno
 * nuevo. Devuelve el hilo para que la UI pueda navegar hasta ahí.
 */
export async function sendClinicEmail(
  clinicId: string,
  input: {
    to: string
    subject?: string | null
    body: string
    /** Responder dentro de este hilo. Si falta, se abre uno nuevo. */
    threadId?: string | null
    ownerId?: string | null
    sentBy?: string | null
  },
): Promise<SendClinicEmailResult> {
  const admin = createAdminClient()

  const creds = await loadEmailCredentials(clinicId)
  if (!creds) {
    throw new Error("La clínica no tiene el correo conectado. Se conecta desde Conexiones.")
  }

  // Hilo destino y headers de hilado.
  let hilo: ThreadRow | null = null
  if (input.threadId) {
    const { data } = await admin
      .from("email_threads")
      .select("id, root_message_id, subject")
      .eq("id", input.threadId)
      .eq("clinic_id", clinicId)
      .maybeSingle()
    hilo = (data as ThreadRow | null) ?? null
    if (!hilo) throw new Error("No se encontró el hilo al que responder")
  }

  const asunto = hilo ? replySubject(hilo.subject ?? input.subject) : (input.subject ?? "").trim()
  if (!asunto) throw new Error("El asunto es obligatorio para un correo nuevo")

  // Message-ID propio: es lo que permite reconocer después las respuestas a este correo.
  const nuestroMessageId = buildMessageId(
    hilo?.id ?? clinicId,
    creds.from_email,
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )

  let hilado: { inReplyTo: string; references: string } | null = null
  if (hilo) {
    hilado = replyHeaders(hilo.root_message_id, await ultimasReferencias(admin, hilo.id))
  }

  const envio = await sendEmail(creds, {
    to: input.to,
    subject: asunto,
    text: input.body,
    messageId: nuestroMessageId,
    inReplyTo: hilado?.inReplyTo ?? null,
    references: hilado?.references ?? null,
  })
  if (!envio.ok) {
    throw new Error(envio.error ?? "No se pudo enviar el correo")
  }

  // A partir de acá el correo YA SALIÓ. Lo que falle es registro, no envío: se avisa, no se lanza —
  // decirle al vet "no se pudo enviar" cuando el cliente ya lo recibió es peor que no decir nada.
  const messageIdFinal = envio.messageId ?? nuestroMessageId
  const ahora = new Date().toISOString()

  try {
    if (!hilo) {
      const { data: creado, error } = await admin
        .from("email_threads")
        .upsert(
          {
            clinic_id: clinicId,
            root_message_id: messageIdFinal,
            subject: asunto,
            participants: [input.to.trim().toLowerCase()],
            owner_id: input.ownerId ?? null,
            last_message_at: ahora,
            updated_at: ahora,
          },
          { onConflict: "clinic_id,root_message_id" },
        )
        .select("id, root_message_id, subject")
        .single()
      if (error || !creado) throw error ?? new Error("hilo no creado")
      hilo = creado as ThreadRow
    }

    const { error: insErr } = await admin.from("email_messages").insert({
      clinic_id: clinicId,
      thread_id: hilo.id,
      message_id: messageIdFinal,
      in_reply_to: hilado?.inReplyTo ?? null,
      references_raw: hilado?.references ?? null,
      direction: "outbound",
      from_email: creds.from_email.toLowerCase(),
      to_emails: [input.to.trim().toLowerCase()],
      subject: asunto,
      body_text: input.body,
      snippet: snippetOf(input.body),
      // Lo enviado nace leído: nadie tiene que "revisarlo".
      read_at: ahora,
      sent_by: input.sentBy ?? null,
      created_at: ahora,
    })
    if (insErr) throw insErr

    await admin
      .from("email_threads")
      .update({ last_message_at: ahora, updated_at: ahora })
      .eq("id", hilo.id)

    return { messageId: messageIdFinal, threadId: hilo.id }
  } catch (e) {
    console.error("[email/send] el correo salió pero no se pudo registrar:", e)
    return {
      messageId: messageIdFinal,
      threadId: hilo?.id ?? "",
      warning:
        "El correo se envió, pero no quedó registrado en la bandeja. Va a aparecer en el próximo barrido.",
    }
  }
}

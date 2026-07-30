import "server-only"

// Lectura del buzón por IMAP. Igual que smtp.ts: transporta y punto — no sabe de facturas ni de
// cartera. Devuelve mensajes ya parseados (headers de hilado + texto + adjuntos) y quien llama
// decide qué hacer con ellos.
//
// Por qué IMAP y no la API de Gmail: mismo motivo que SMTP (ver migración 0039) — las App
// Passwords están exceptuadas del requisito de OAuth, y el scope de lectura de la API es
// RESTRINGIDO (auditoría CASA). Bonus: IMAP es estándar, así que esta misma implementación sirve
// para Outlook cuando entre (solo cambia cómo se obtiene la credencial: allá es OAuth).

import { ImapFlow } from "imapflow"
import { simpleParser } from "mailparser"

import type { EmailCredentials } from "./integrations"

export interface InboundAttachment {
  filename: string
  contentType: string | null
  bytes: Buffer
}

export interface InboundEmail {
  /** UID de IMAP: monótono creciente por mailbox — es el cursor del barrido. */
  uid: number
  messageId: string | null
  inReplyTo: string | null
  references: string | null
  fromEmail: string | null
  subject: string | null
  /** Cuerpo en texto plano (si el correo era solo HTML, mailparser lo degrada a texto). */
  text: string
  attachments: InboundAttachment[]
  date: Date | null
}

/** Adjuntos más grandes que esto se ignoran (comprobantes reales pesan KB, no decenas de MB). */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** Tope de mensajes por barrido: un buzón compartido con tráfico ajeno no debe colgar el cron. */
const MAX_MESSAGES_PER_SWEEP = 200

const TIMEOUT_MS = 30_000

function clientFor(creds: EmailCredentials): ImapFlow {
  return new ImapFlow({
    host: creds.imap_host,
    port: creds.imap_port,
    secure: true,
    auth: { user: creds.from_email, pass: creds.credential },
    socketTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    // El logger default escupe JSON por consola en cada comando; en serverless es puro ruido.
    logger: false,
  })
}

/** Handshake de solo conexión + apertura del mailbox. Para el flujo de conectar en Configuración. */
export async function verifyImap(creds: EmailCredentials): Promise<{ ok: boolean; error?: string }> {
  const client = clientFor(creds)
  try {
    await client.connect()
    const lock = await client.getMailboxLock(creds.imap_mailbox)
    lock.release()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "No se pudo conectar a IMAP" }
  } finally {
    await client.logout().catch(() => {})
  }
}

/**
 * Mensajes NUEVOS del mailbox: UID estrictamente mayor que `sinceUid`, en orden ascendente.
 *
 * El orden ascendente importa: el caller actualiza su cursor a medida que procesa, así que si el
 * barrido muere a mitad, el próximo retoma desde el último procesado — reprocesa a lo sumo una
 * ventana pequeña, nunca saltea.
 *
 * `sinceUid = null` es la primera corrida: se acota por fecha (14 días) para no escanear un buzón
 * con años de historia. Lo anterior a la conexión del correo no es de Tuvetia.
 */
export async function fetchNewMessages(
  creds: EmailCredentials,
  sinceUid: number | null,
): Promise<InboundEmail[]> {
  const client = clientFor(creds)
  const out: InboundEmail[] = []
  try {
    await client.connect()
    const lock = await client.getMailboxLock(creds.imap_mailbox)
    try {
      const range = sinceUid
        ? { uid: `${sinceUid + 1}:*` }
        : { since: new Date(Date.now() - 14 * 24 * 3600_000) }
      const uids = await client.search(range, { uid: true })
      if (!uids || uids.length === 0) return []

      // `uid: "N:*"` con N mayor al último UID devuelve el último mensaje igual (semántica de
      // IMAP); el filtro explícito lo descarta.
      const fresh = uids.filter((u) => (sinceUid ? u > sinceUid : true)).sort((a, b) => a - b)
      const bounded = fresh.slice(0, MAX_MESSAGES_PER_SWEEP)

      for (const uid of bounded) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
        if (!msg || !msg.source) continue
        const parsed = await simpleParser(msg.source)
        out.push({
          uid,
          messageId: parsed.messageId ?? null,
          inReplyTo: parsed.inReplyTo ?? null,
          // mailparser tipa `references` como string | string[]: se normaliza al formato header.
          references: Array.isArray(parsed.references)
            ? parsed.references.join(" ")
            : (parsed.references ?? null),
          fromEmail: parsed.from?.value?.[0]?.address?.toLowerCase() ?? null,
          subject: parsed.subject ?? null,
          text: (parsed.text ?? "").trim(),
          attachments: (parsed.attachments ?? [])
            .filter((a) => a.content && a.content.length <= MAX_ATTACHMENT_BYTES)
            .map((a) => ({
              filename: a.filename ?? "adjunto",
              contentType: a.contentType ?? null,
              bytes: a.content as Buffer,
            })),
          date: parsed.date ?? null,
        })
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
  return out
}

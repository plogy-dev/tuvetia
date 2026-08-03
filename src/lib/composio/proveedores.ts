import "server-only"

// Los dos proveedores de correo que puede conectar un miembro: Gmail y Outlook.
//
// Existe este archivo porque las tools de Composio NO son intercambiables entre proveedores. Los
// nombres de los parámetros difieren (Gmail manda `recipient_email`, Outlook `to_email`), y
// responder es directamente otra operación: Gmail reusa el envío pasándole `thread_id`, mientras
// Outlook tiene una tool aparte que toma `message_id` y el texto en `comment`.
//
// Sin esta capa, cada llamada del agente tendría que saber con qué proveedor está hablando. Con
// ella, el resto del código pide "enviar" o "buscar" y acá se traduce.

// El tipo y los nombres visibles viven en un módulo sin `server-only`: los botones de conexión son
// componentes de cliente y no pueden importar este archivo.
export { NOMBRE_PROVEEDOR, type Proveedor } from "./proveedores-nombres"

import type { Proveedor } from "./proveedores-nombres"

/** Un correo, ya normalizado — misma forma venga de donde venga. */
export interface CorreoNormalizado {
  id: string
  /** Con qué id se responde: el hilo en Gmail, el mensaje en Outlook. */
  refRespuesta: string
  de: string
  para: string
  asunto: string
  preview: string
  fecha: string
  esPropio: boolean
  leido: boolean
  adjuntos: number
}

export interface Adaptador {
  toolkit: string
  /** Versión del toolkit. Ejecutar a mano exige una fija: "latest" no sirve. */
  version: string
  /** Variable de entorno con el auth config de Composio. */
  envAuthConfig: string
  buscar(query: string, limite: number): { slug: string; args: Record<string, unknown> }
  enviar(a: string, asunto: string, cuerpo: string): { slug: string; args: Record<string, unknown> }
  responder(input: {
    ref: string
    a: string
    asunto: string
    cuerpo: string
  }): { slug: string; args: Record<string, unknown> }
  normalizar(data: unknown, correoPropio: string | null): CorreoNormalizado[]
}

// ─── Gmail ────────────────────────────────────────────────────────────────────

type MensajeGmail = {
  messageId?: string
  threadId?: string
  sender?: string
  to?: string
  subject?: string
  preview?: { body?: string }
  messageText?: string
  messageTimestamp?: string
  labelIds?: string[]
  attachmentList?: unknown[]
}

const GMAIL: Adaptador = {
  toolkit: "gmail",
  // Verificada contra la API el 2026-08-03. Las disponibles salen del campo `availableVersions`
  // de la definición de la tool.
  version: process.env.COMPOSIO_GMAIL_TOOLKIT_VERSION?.trim() || "20260721_00",
  envAuthConfig: "COMPOSIO_GMAIL_AUTH_CONFIG_ID",

  buscar: (query, limite) => ({
    slug: "GMAIL_FETCH_EMAILS",
    args: { max_results: limite, ...(query ? { query } : {}) },
  }),
  enviar: (a, asunto, cuerpo) => ({
    slug: "GMAIL_SEND_EMAIL",
    args: { recipient_email: a, subject: asunto, body: cuerpo },
  }),
  // Gmail no tiene tool de respuesta: se envía con el `thread_id`, que es lo que hace que quede
  // DENTRO de la conversación en vez de abrir una nueva.
  responder: ({ ref, a, asunto, cuerpo }) => ({
    slug: "GMAIL_SEND_EMAIL",
    args: { recipient_email: a, subject: asunto, body: cuerpo, thread_id: ref },
  }),

  normalizar: (data) => {
    const msgs = (data as { messages?: MensajeGmail[] } | undefined)?.messages ?? []
    return msgs.map((m) => {
      const labels = m.labelIds ?? []
      return {
        id: m.messageId ?? "",
        refRespuesta: m.threadId ?? m.messageId ?? "",
        de: m.sender ?? "(desconocido)",
        para: m.to ?? "",
        asunto: m.subject ?? "(sin asunto)",
        preview: (m.preview?.body ?? m.messageText ?? "").slice(0, 200),
        fecha: m.messageTimestamp ?? new Date().toISOString(),
        // La etiqueta SENT es más fiable que comparar direcciones: el vet puede tener alias, y
        // `sender` viene como "Nombre <correo>".
        esPropio: labels.includes("SENT"),
        leido: !labels.includes("UNREAD"),
        adjuntos: (m.attachmentList ?? []).length,
      }
    })
  },
}

// ─── Outlook ──────────────────────────────────────────────────────────────────

// Microsoft Graph devuelve los mensajes con esta forma. Se lee defensivamente porque Composio no
// documenta si los pasa tal cual o los envuelve — y una bandeja que revienta por un campo que
// cambió de nombre es peor que una que muestra "(sin asunto)".
type MensajeOutlook = {
  id?: string
  conversationId?: string
  subject?: string
  bodyPreview?: string
  receivedDateTime?: string
  sentDateTime?: string
  isRead?: boolean
  hasAttachments?: boolean
  from?: { emailAddress?: { address?: string; name?: string } }
  sender?: { emailAddress?: { address?: string; name?: string } }
  toRecipients?: { emailAddress?: { address?: string; name?: string } }[]
}

function direccionOutlook(e?: { emailAddress?: { address?: string; name?: string } }): string {
  const a = e?.emailAddress
  if (!a?.address) return ""
  return a.name ? `${a.name} <${a.address}>` : a.address
}

const OUTLOOK: Adaptador = {
  toolkit: "outlook",
  // El toolkit de Outlook expone una sola versión.
  version: process.env.COMPOSIO_OUTLOOK_TOOLKIT_VERSION?.trim() || "00000000_00",
  envAuthConfig: "COMPOSIO_OUTLOOK_AUTH_CONFIG_ID",

  buscar: (query, limite) => ({
    slug: "OUTLOOK_OUTLOOK_SEARCH_MESSAGES",
    // `query` es obligatorio acá (a diferencia de Gmail, que lista sin filtro): sin texto se pide
    // lo recibido, que es lo más parecido a "mostrame la bandeja".
    args: { query: query || "isRead:false OR isRead:true", size: limite },
  }),
  enviar: (a, asunto, cuerpo) => ({
    slug: "OUTLOOK_OUTLOOK_SEND_EMAIL",
    args: { to_email: a, subject: asunto, body: cuerpo },
  }),
  // Outlook SÍ tiene tool de respuesta, y toma el id del MENSAJE (no del hilo) y el texto en
  // `comment`. El asunto y el destinatario los resuelve Graph desde el mensaje original.
  responder: ({ ref, cuerpo }) => ({
    slug: "OUTLOOK_OUTLOOK_REPLY_EMAIL",
    args: { message_id: ref, comment: cuerpo },
  }),

  normalizar: (data, correoPropio) => {
    const d = data as { messages?: MensajeOutlook[]; value?: MensajeOutlook[] } | MensajeOutlook[] | undefined
    const msgs: MensajeOutlook[] = Array.isArray(d) ? d : (d?.messages ?? d?.value ?? [])
    const propio = (correoPropio ?? "").toLowerCase()
    return msgs.map((m) => {
      const de = direccionOutlook(m.from ?? m.sender)
      return {
        id: m.id ?? "",
        // Se responde al MENSAJE, no al hilo.
        refRespuesta: m.id ?? "",
        de: de || "(desconocido)",
        para: (m.toRecipients ?? []).map(direccionOutlook).filter(Boolean).join(", "),
        asunto: m.subject ?? "(sin asunto)",
        preview: (m.bodyPreview ?? "").slice(0, 200),
        fecha: m.receivedDateTime ?? m.sentDateTime ?? new Date().toISOString(),
        // Graph no trae una etiqueta como SENT: se compara el remitente con la cuenta conectada.
        esPropio: Boolean(propio) && de.toLowerCase().includes(propio),
        leido: m.isRead !== false,
        adjuntos: m.hasAttachments ? 1 : 0,
      }
    })
  },
}

const ADAPTADORES: Record<Proveedor, Adaptador> = { gmail: GMAIL, outlook: OUTLOOK }

export function adaptador(p: Proveedor): Adaptador {
  return ADAPTADORES[p]
}

/** Los proveedores que este despliegue tiene configurados (con su auth config presente). */
export function proveedoresDisponibles(): Proveedor[] {
  return (Object.keys(ADAPTADORES) as Proveedor[]).filter(
    (p) => (process.env[ADAPTADORES[p].envAuthConfig] ?? "").trim() !== "",
  )
}

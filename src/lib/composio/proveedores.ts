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
  /**
   * ¿El destinatario de una respuesta lo fija el proveedor?
   *
   * Cuando es `true`, responder no acepta destinatario: lo resuelve el proveedor a partir del
   * mensaje original. Eso cierra por construcción la vía de inyección que hay cuando la dirección
   * viaja en el payload — ver `verificarDestinatarioDeRespuesta` en correo.ts.
   */
  respuestaFijaDestinatario: boolean
  buscar(query: string, limite: number): { slug: string; args: Record<string, unknown> }
  enviar(a: string, asunto: string, cuerpo: string): { slug: string; args: Record<string, unknown> }
  responder(input: {
    ref: string
    a: string
    asunto: string
    cuerpo: string
  }): { slug: string; args: Record<string, unknown> }
  /** Trae la conversación a la que apunta `ref`, para verificar quién participa de ella. */
  buscarHilo(ref: string): { slug: string; args: Record<string, unknown> }
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
  // Gmail responde con un envío normal, así que el destinatario lo elegimos nosotros — y por eso
  // hay que verificarlo contra el hilo antes de mandarlo.
  respuestaFijaDestinatario: false,

  buscarHilo: (ref) => ({
    slug: "GMAIL_FETCH_EMAILS",
    args: { query: `thread:${ref}`, max_results: 30 },
  }),

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

// Microsoft Graph devuelve los mensajes con esta forma.
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

/**
 * Saca la lista de mensajes de una respuesta de Outlook.
 *
 * Hay tres formas que atender, y no es defensa preventiva sino lo que devuelven de verdad las tools
 * (verificado contra los esquemas de Composio el 2026-08-03):
 *
 * 1. Todo viene envuelto en `data.response_data` — adentro está el JSON crudo de Graph.
 * 2. `LIST_MESSAGES` devuelve la colección normal de Graph: `{ value: [...] }`.
 * 3. `SEARCH_MESSAGES` NO usa ese endpoint sino la Search API, que anida los resultados en
 *    `value[].hitsContainers[].hits[].resource`. Un normalizador que solo leyera `value` devolvería
 *    la bandeja vacía cada vez que el vet busca algo — sin error, que es lo peor que puede pasar.
 */
function mensajesDeOutlook(data: unknown): MensajeOutlook[] {
  const raiz = (data as { response_data?: unknown })?.response_data ?? data
  if (Array.isArray(raiz)) return raiz as MensajeOutlook[]

  const valor = (raiz as { value?: unknown; messages?: unknown })?.value
  const mensajes = (raiz as { messages?: unknown })?.messages
  if (Array.isArray(mensajes)) return mensajes as MensajeOutlook[]
  if (!Array.isArray(valor)) return []

  // Search API: los mensajes están dentro de los "hits". Si el primer elemento trae contenedores,
  // es esa forma; si no, es la colección normal.
  type Contenedor = { hitsContainers?: { hits?: { resource?: MensajeOutlook }[] }[] }
  const hits = (valor as Contenedor[]).flatMap(
    (v) => v?.hitsContainers?.flatMap((c) => c.hits ?? []) ?? [],
  )
  if (hits.length > 0) return hits.map((h) => h.resource ?? {})
  return valor as MensajeOutlook[]
}

const OUTLOOK: Adaptador = {
  toolkit: "outlook",
  // Verificada contra la API el 2026-08-03, igual que la de Gmail. La default del toolkit es
  // `00000000_00`, que NO se usa a propósito: es la que se mueve sola, y entonces un cambio en la
  // forma de la respuesta llegaría a producción sin aviso. Se fija la última con fecha.
  version: process.env.COMPOSIO_OUTLOOK_TOOLKIT_VERSION?.trim() || "20251016_01",
  envAuthConfig: "COMPOSIO_OUTLOOK_AUTH_CONFIG_ID",
  // OUTLOOK_OUTLOOK_REPLY_EMAIL NO acepta destinatario: Graph lo saca del mensaje original. La
  // dirección no viaja en la llamada, así que no hay nada que redirigir.
  respuestaFijaDestinatario: true,

  // Listar y buscar son dos tools distintas a propósito. `SEARCH_MESSAGES` exige texto, así que
  // usarla para "mostrame la bandeja" obligaba a inventar una consulta; `LIST_MESSAGES` ordena por
  // fecha sin filtro, que es exactamente lo que se quiere al abrir la página.
  buscar: (query, limite) =>
    query
      ? { slug: "OUTLOOK_OUTLOOK_SEARCH_MESSAGES", args: { query, size: limite } }
      : {
          slug: "OUTLOOK_OUTLOOK_LIST_MESSAGES",
          args: { top: limite, orderby: "receivedDateTime desc" },
        },
  enviar: (a, asunto, cuerpo) => ({
    slug: "OUTLOOK_OUTLOOK_SEND_EMAIL",
    args: { to_email: a, subject: asunto, body: cuerpo },
  }),
  // Outlook SÍ tiene tool de respuesta, y toma el id del MENSAJE (no del hilo) y el texto en
  // `comment`. El asunto y el destinatario los resuelve Graph desde el mensaje original, así que
  // `a` y `asunto` se ignoran acá — no es un olvido: no hay dónde ponerlos.
  responder: ({ ref, cuerpo }) => ({
    slug: "OUTLOOK_OUTLOOK_REPLY_EMAIL",
    args: { message_id: ref, comment: cuerpo },
  }),
  buscarHilo: (ref) => ({ slug: "OUTLOOK_OUTLOOK_GET_MESSAGE", args: { message_id: ref } }),

  normalizar: (data, correoPropio) => {
    const propio = (correoPropio ?? "").toLowerCase()
    return mensajesDeOutlook(data).map((m) => {
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

// ─── Quién participa de un hilo ───────────────────────────────────────────────

// Claves de cabecera de las que SÍ se leen direcciones. Es una lista blanca a propósito, y es lo
// único que hace útil a `participantesDelHilo`: si en vez de esto se recolectara cualquier correo
// que aparezca en la respuesta, el CUERPO de un mensaje entraría en la cuenta — y entonces un correo
// entrante que diga "escribe a atacante@ejemplo.com" se auto-autorizaría como destinatario válido,
// que es exactamente el ataque del que la verificación protege.
//
// Están los nombres de los dos proveedores: Gmail manda `to`/`from`, Graph `toRecipients`/`from`.
// Una vez adentro de una de estas claves la marca sigue hacia abajo, así que `emailAddress.address`
// (el anidado de Graph) queda cubierto sin nombrarlo.
const CLAVES_DE_PARTICIPANTE =
  /^(from|to|cc|bcc|sender|recipient|recipients|reply_?to|delivered_?to|(to|cc|bcc|reply)Recipients)$/i
const CORREO = /[\w.+-]+@[\w-]+\.[\w.-]+/g

/**
 * Las direcciones que PARTICIPAN de un hilo, sacadas de la respuesta cruda del proveedor. Función
 * pura: se le pasa el `data` tal cual y devuelve correos en minúscula.
 *
 * Camina la estructura sin asumir su forma exacta —Composio la puede cambiar entre versiones, y
 * Gmail y Graph no se parecen— pero sólo "se arma" al entrar en una clave de cabecera. Una vez
 * dentro sigue armada hacia abajo, para cubrir tanto `to: "a@x.com"` como `to: [{ email: "a@x.com" }]`.
 */
export function participantesDelHilo(data: unknown): string[] {
  const encontrados = new Set<string>()
  const visitar = (nodo: unknown, armado: boolean): void => {
    if (nodo == null) return
    if (typeof nodo === "string") {
      if (armado) for (const m of nodo.matchAll(CORREO)) encontrados.add(m[0].toLowerCase())
      return
    }
    if (Array.isArray(nodo)) {
      for (const x of nodo) visitar(x, armado)
      return
    }
    if (typeof nodo === "object") {
      for (const [k, v] of Object.entries(nodo)) visitar(v, armado || CLAVES_DE_PARTICIPANTE.test(k))
    }
  }
  visitar(data, false)
  return [...encontrados]
}

/** ¿Esa dirección aparece como participante del hilo? */
export function destinatarioEnHilo(email: string, data: unknown): boolean {
  return participantesDelHilo(data).includes(email.trim().toLowerCase())
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

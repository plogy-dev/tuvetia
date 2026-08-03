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
  /** Con qué id se responde: el hilo en Gmail, el MENSAJE en Outlook. */
  refRespuesta: string
  /** Con qué id se pide la conversación entera: el hilo en Gmail, el `conversationId` en Outlook. */
  refConversacion: string
  de: string
  para: string
  asunto: string
  preview: string
  fecha: string
  esPropio: boolean
  leido: boolean
  adjuntos: number
  /** A dónde ir para leerlo entero en el webmail del proveedor. */
  enlace: string
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
  /** Trae la conversación entera. `ref` es un `refConversacion`, no un `refRespuesta`. */
  buscarConversacion(ref: string): { slug: string; args: Record<string, unknown> }
  /**
   * Trae el perfil de la cuenta conectada — de acá sale la dirección desde la que se envía.
   *
   * Hace falta una llamada aparte porque NINGUNO de los dos proveedores incluye el correo en los
   * datos de la cuenta conectada (verificado: sólo tokens y scopes). Antes se intentaba leerlo de
   * ahí y siempre salía null, así que Conexiones no mostraba ninguna dirección.
   */
  perfil(): { slug: string; args: Record<string, unknown> }
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

  // En Gmail `refRespuesta` y `refConversacion` son el MISMO id (el del hilo), y de eso depende que
  // la verificación de destinatario pueda pedir la conversación con lo que trae el payload. Hay un
  // test que lo fija.
  buscarConversacion: (ref) => ({
    slug: "GMAIL_FETCH_EMAILS",
    args: { query: `thread:${ref}`, max_results: 30 },
  }),

  perfil: () => ({ slug: "GMAIL_GET_PROFILE", args: {} }),

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
        refConversacion: m.threadId ?? m.messageId ?? "",
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
        enlace: `https://mail.google.com/mail/u/0/#all/${m.threadId ?? m.messageId ?? ""}`,
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
  webLink?: string
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
 * Composio envuelve el JSON crudo de Graph en `data.response_data`, y Graph devuelve las colecciones
 * en `value`. Se aceptan además las dos variantes sueltas (un array pelado, o `messages`) porque no
 * cuesta nada y evita que un cambio de envoltorio deje la bandeja muda.
 */
function mensajesDeOutlook(data: unknown): MensajeOutlook[] {
  const raiz = (data as { response_data?: unknown })?.response_data ?? data
  if (Array.isArray(raiz)) return raiz as MensajeOutlook[]
  const r = raiz as { value?: unknown; messages?: unknown } | null | undefined
  if (Array.isArray(r?.messages)) return r.messages as MensajeOutlook[]
  if (Array.isArray(r?.value)) return r.value as MensajeOutlook[]
  return []
}

const PARECE_CORREO = /^[\w.+-]+@[\w-]+\.[\w.-]+$/

/**
 * Traduce una búsqueda libre a los filtros de LIST_MESSAGES.
 *
 * NO se usa OUTLOOK_OUTLOOK_SEARCH_MESSAGES, y esto no es preferencia: esa tool va contra la
 * Microsoft Search API, que **no existe para cuentas personales** de Microsoft. Con una cuenta
 * outlook.com toda búsqueda respondía
 *
 *     "This API is not supported for MSA accounts"
 *
 * `/me/messages` —lo que usa LIST_MESSAGES— funciona con los dos tipos de cuenta, así que se usa
 * siempre y no se ramifica por tipo de cuenta: no tenemos cómo saber cuál conectó el vet, y elegir
 * mal significaría que la bandeja no carga.
 *
 * Lo que se pierde: Graph aplica estos filtros SOBRE LO YA TRAÍDO, no en el servidor, y sólo miran
 * asunto y remitente — no el cuerpo. Por eso al filtrar se pide un lote grande: buscar mira los
 * mensajes recientes, no el buzón entero.
 */
function filtrosOutlook(query: string, limite: number): Record<string, unknown> {
  // `folder` explícito: sin él la tool ya devuelve la bandeja de entrada (verificado contra una
  // cuenta real — sin folder y con `inbox` dan lo mismo, y `sentitems` da otra cosa), pero dejarlo
  // escrito evita que un cambio de default lo mueva sin que nadie se entere.
  //
  // Consecuencia a tener presente: la búsqueda mira lo RECIBIDO. "¿Qué le escribí a X?" no lo
  // encuentra. En Gmail sí, porque su búsqueda abarca todo el buzón.
  const orden = { folder: "inbox", orderby: ["receivedDateTime desc"] }
  if (!query) return { top: limite, ...orden }
  const filtro = PARECE_CORREO.test(query.trim())
    ? { from_address: query.trim() }
    : { subject_contains: query.trim() }
  return { top: Math.max(limite, 100), ...orden, ...filtro }
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

  // Listar y buscar son la MISMA tool acá: ver `filtrosOutlook` para por qué no se usa la de
  // búsqueda.
  perfil: () => ({ slug: "OUTLOOK_OUTLOOK_GET_PROFILE", args: {} }),

  buscar: (query, limite) => ({
    slug: "OUTLOOK_OUTLOOK_LIST_MESSAGES",
    args: filtrosOutlook(query, limite),
  }),
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
  // La conversación se pide por `conversationId`, que es lo que agrupa el hilo en Graph. GET_MESSAGE
  // traería UN mensaje: alcanzaría para ver quién participa, pero no para leer el hilo antes de
  // responder, que es para lo que Athos lo usa.
  buscarConversacion: (ref) => ({
    slug: "OUTLOOK_OUTLOOK_LIST_MESSAGES",
    args: { conversationId: ref, top: 30, orderby: ["receivedDateTime desc"] },
  }),

  normalizar: (data, correoPropio) => {
    const propio = (correoPropio ?? "").toLowerCase()
    return mensajesDeOutlook(data).map((m) => {
      const de = direccionOutlook(m.from ?? m.sender)
      return {
        id: m.id ?? "",
        // Se responde al MENSAJE (REPLY_EMAIL toma `message_id`), pero el hilo se pide por
        // `conversationId`: en Outlook no son el mismo id, a diferencia de Gmail.
        refRespuesta: m.id ?? "",
        refConversacion: m.conversationId ?? m.id ?? "",
        de: de || "(desconocido)",
        para: (m.toRecipients ?? []).map(direccionOutlook).filter(Boolean).join(", "),
        asunto: m.subject ?? "(sin asunto)",
        preview: (m.bodyPreview ?? "").slice(0, 200),
        fecha: m.receivedDateTime ?? m.sentDateTime ?? new Date().toISOString(),
        // Graph no trae una etiqueta como SENT: se compara el remitente con la cuenta conectada.
        esPropio: Boolean(propio) && de.toLowerCase().includes(propio),
        leido: m.isRead !== false,
        adjuntos: m.hasAttachments ? 1 : 0,
        // `webLink` lo da Graph por mensaje. Es lo único correcto: una cuenta personal abre en
        // outlook.live.com y una de trabajo en outlook.office.com, así que un enlace fijo lleva al
        // lugar equivocado a la mitad de la gente.
        enlace: m.webLink ?? "https://outlook.live.com/mail/",
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

// ─── La dirección desde la que se envía, y si de verdad puede enviar ──────────

/**
 * La dirección de la cuenta conectada, sacada de la respuesta del perfil.
 *
 * Cada proveedor la llama distinto (Gmail `emailAddress`, Graph `mail` o `userPrincipalName`) y
 * Composio a veces envuelve en `response_data`. Se prueban todas las variantes en vez de ramificar:
 * es un dato chico y no vale un `if` por proveedor.
 */
export function direccionDelPerfil(data: unknown): string | null {
  const raiz = (data as { response_data?: unknown })?.response_data ?? data
  const d = (raiz ?? {}) as Record<string, unknown>
  for (const k of ["emailAddress", "email", "mail", "userPrincipalName"]) {
    const v = d[k]
    if (typeof v === "string" && v.includes("@")) return v
  }
  return null
}

// Dominios de correo de consumo que administra OTRO proveedor. Si una cuenta de Microsoft tiene su
// dirección en uno de estos, Microsoft no puede autenticarla y el correo no se entrega.
//
// La lista es corta a propósito: sólo casos donde la respuesta es SEGURA. Un dominio propio
// (clinica.com) puede estar perfectamente configurado para que Microsoft envíe por él, así que
// callarse ahí es lo correcto — avisar de más entrena a la gente a ignorar los avisos.
const DOMINIOS_DE_OTRO_PROVEEDOR = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.es",
  "yahoo.com.mx",
  "yahoo.com.ar",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "yandex.com",
  "zoho.com",
])

/**
 * ¿Los correos de esta cuenta van a llegar?
 *
 * Devuelve el aviso a mostrar, o null si no hay motivo para sospechar.
 *
 * EL CASO REAL: se conectó una cuenta de Microsoft cuya dirección es `@gmail.com` — se puede, una
 * cuenta Microsoft se registra con cualquier correo. Los envíos salían bien (quedaban en Enviados,
 * la API decía éxito) y NO LLEGABAN a ningún lado, porque el SPF de gmail.com sólo autoriza a
 * Google: un correo que sale de Microsoft diciendo ser de gmail.com falla la autenticación y el que
 * lo recibe lo manda a spam o lo descarta. Como Athos mostraba "Ejecutada", el veterinario quedaba
 * convencido de haber contactado al titular.
 *
 * Con Gmail no pasa: la dirección de la cuenta siempre es de Google, que es quien envía.
 */
export function avisoDeEntrega(proveedor: Proveedor, email: string | null): string | null {
  if (proveedor !== "outlook" || !email) return null
  const dominio = email.split("@")[1]?.toLowerCase()
  if (!dominio || !DOMINIOS_DE_OTRO_PROVEEDOR.has(dominio)) return null
  return `Los correos saldrían como ${email}, pero ${dominio} no autoriza a los servidores de Microsoft a enviar por él: van a caer en spam o directamente no van a llegar, aunque acá figuren como enviados. Conectá una cuenta de Microsoft cuya dirección sea de Microsoft o del dominio de la clínica — o conectá ${email} por Gmail, que sí puede enviar por ese dominio.`
}

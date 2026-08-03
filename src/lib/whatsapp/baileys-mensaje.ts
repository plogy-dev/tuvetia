// Leer un mensaje de Baileys (Evolution API). Vive fuera de la ruta para poder probarlo sin un
// WhatsApp delante — que es exactamente lo que faltaba cuando esto se escribió.
//
// EL DEFECTO QUE LO ORIGINA. El 2026-08-03, con el número CONECTADO y el `connection.update`
// llegando bien a nuestro webhook, `whatsapp_messages` seguía en cero. Los dos motivos posibles
// estaban acá, y los dos descartaban en silencio.

export type EvoContenido = {
  conversation?: string
  extendedTextMessage?: { text?: string }
  imageMessage?: { caption?: string }
  videoMessage?: { caption?: string }
  audioMessage?: object
  documentMessage?: { fileName?: string }
  stickerMessage?: object
  ephemeralMessage?: { message?: EvoContenido }
  viewOnceMessage?: { message?: EvoContenido }
  viewOnceMessageV2?: { message?: EvoContenido }
  viewOnceMessageV2Extension?: { message?: EvoContenido }
  deviceSentMessage?: { message?: EvoContenido }
  documentWithCaptionMessage?: { message?: EvoContenido }
  editedMessage?: { message?: EvoContenido }
}

export type EvoMessage = {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string }
  pushName?: string
  messageTimestamp?: number | string
  message?: EvoContenido
}

// ── 1. Baileys casi nunca entrega el contenido plano ────────────────────────────────────────────
//
// Lo envuelve, y a veces dos veces seguidas. Los dos casos que más importan acá:
//
//   · `deviceSentMessage` — lo que uno se manda A SÍ MISMO, o desde otro dispositivo vinculado.
//     Como la instancia de Evolution ES un dispositivo vinculado del teléfono del vet, ésta es la
//     forma que toma la primera prueba que cualquiera hace.
//   · `ephemeralMessage` — chats con mensajes temporales, que WhatsApp activa por defecto cada vez
//     en más conversaciones. No es un caso raro: es el caso normal a futuro.
//
// Sin desenvolver, `conversation` es undefined, no hay media, y el mensaje se descarta entero.
const CONTENEDORES = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "deviceSentMessage",
  "documentWithCaptionMessage",
  "editedMessage",
] as const

const PROFUNDIDAD_MAXIMA = 5

export function desenvolver(msg: EvoContenido | undefined, profundidad = 0): EvoContenido | undefined {
  if (!msg || profundidad >= PROFUNDIDAD_MAXIMA) return msg
  for (const envoltorio of CONTENEDORES) {
    const dentro = msg[envoltorio]?.message
    if (dentro) return desenvolver(dentro, profundidad + 1)
  }
  return msg
}

export function textoDeMensaje(m: EvoMessage): string | null {
  const msg = desenvolver(m.message)
  if (!msg) return null
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    null
  )
}

export function tipoDeMedia(m: EvoMessage): string | null {
  const msg = desenvolver(m.message)
  if (!msg) return null
  if (msg.imageMessage) return "image"
  if (msg.videoMessage) return "video"
  if (msg.audioMessage) return "audio"
  if (msg.documentMessage) return "document"
  if (msg.stickerMessage) return "sticker"
  return null
}

/** Las claves del contenido ya desenvuelto. Para loguear QUÉ llegó sin loguear su contenido. */
export function tiposDeContenido(m: EvoMessage): string {
  return Object.keys(desenvolver(m.message) ?? {}).join(",") || "sin-message"
}

// ── 2. Grupos, difusiones, estados y newsletters: JAMÁS ─────────────────────────────────────────
//
// Es la protección dura del agente y no se toca. Lo que SÍ cambió es cómo se expresa: era una lista
// blanca de `@s.whatsapp.net`, y WhatsApp está migrando el direccionamiento a LID (`@lid`), así que
// una conversación individual perfectamente normal podía llegar con un JID que la lista blanca no
// reconocía — y se descartaba entera, en silencio.
//
// Invertirla no debilita nada: un grupo es exactamente `@g.us`, una difusión (y los estados)
// `@broadcast`, y un canal `@newsletter`. Lo que se gana es dejar de depender de que WhatsApp nunca
// cambie el formato de los individuales, que es justo lo que está cambiando.
const JIDS_QUE_NO_SE_TOCAN = ["@g.us", "@broadcast", "@newsletter"]

export function esConversacionIndividual(jid: string): boolean {
  if (!jid.includes("@")) return false
  return !JIDS_QUE_NO_SE_TOCAN.some((sufijo) => jid.endsWith(sufijo))
}

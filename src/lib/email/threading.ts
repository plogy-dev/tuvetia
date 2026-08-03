// Hilado de correo según RFC 5322 — lógica PURA, sin IO.
//
// Es lo que hace que la respuesta del titular caiga en el mismo hilo que la factura que le
// enviamos, y que el cron sepa a qué factura pertenece un mensaje entrante. Si esto falla, la
// cobranza por correo se rompe de la peor manera: el cliente responde y nadie se entera.
//
// Se usa Message-ID en vez del `threadId` de Gmail a propósito: Message-ID es estándar, así que la
// misma lógica sirve para Outlook y cualquier otro proveedor. El threadId de Gmail es propietario.

/** Dominio de fallback cuando el remitente no tiene uno usable (no debería pasar). */
const FALLBACK_DOMAIN = "tuvetia.com"

/**
 * Message-ID de un correo de factura. Formato `<factura.<invoiceId>.<n>@dominio>`.
 *
 * Lleva el invoiceId adentro a propósito: si algún día se pierde la fila de invoice_email_threads,
 * el hilo todavía se puede reconstruir leyendo el header. Y `n` (un contador o timestamp) permite
 * reenviar la misma factura sin colisionar — dos correos jamás comparten Message-ID, que es un
 * requisito del RFC y algunos servidores rechazan el duplicado.
 */
export function buildMessageId(invoiceId: string, fromEmail: string, unique: string): string {
  const domain = domainOf(fromEmail) ?? FALLBACK_DOMAIN
  // El local-part no puede llevar `<`, `>` ni espacios; invoiceId es un uuid y `unique` lo generamos
  // nosotros, pero se sanea igual para no depender de eso.
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "")
  return `<factura.${safe(invoiceId)}.${safe(unique)}@${domain}>`
}

/** Dominio de una dirección, o null si no parece una dirección. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@")
  if (at <= 0 || at === email.length - 1) return null
  const domain = email.slice(at + 1).trim().toLowerCase()
  return domain.includes(".") ? domain : null
}

/**
 * Extrae los Message-ID de un header `References` o `In-Reply-To`.
 *
 * Esos headers vienen como una lista separada por espacios y/o saltos de línea (folding), y en la
 * práctica los clientes de correo mandan de todo: comas, espacios de más, saltos en medio. Se
 * extrae por patrón en vez de partir por separador — es lo único robusto acá.
 */
export function parseMessageIds(header: string | null | undefined): string[] {
  if (!header) return []
  return header.match(/<[^<>\s]+@[^<>\s]+>/g) ?? []
}

/**
 * ¿Este mensaje entrante pertenece al hilo de `rootMessageId`?
 *
 * Se mira References Y In-Reply-To: References tiene la cadena completa, pero algunos clientes
 * (Outlook viejo entre ellos) solo mandan In-Reply-To. Con uno de los dos alcanza.
 *
 * La comparación es case-insensitive en el dominio pero EXACTA en el local-part, que es lo que
 * manda el RFC 5322 §3.6.4. En la práctica se compara todo en minúscula porque los servidores no
 * respetan la distinción y una comparación estricta produce falsos negativos —que acá significan
 * "la respuesta del cliente se pierde", el peor resultado posible.
 */
export function belongsToThread(
  rootMessageId: string,
  headers: { references?: string | null; inReplyTo?: string | null },
): boolean {
  const root = rootMessageId.trim().toLowerCase()
  if (!root) return false
  const ids = [...parseMessageIds(headers.references), ...parseMessageIds(headers.inReplyTo)]
  return ids.some((id) => id.trim().toLowerCase() === root)
}

/**
 * Headers para responder DENTRO del hilo.
 *
 * `In-Reply-To` es el mensaje puntual al que se responde; `References` la cadena completa, y va
 * acotada a los últimos 20: algunos servidores rechazan headers muy largos y el hilado no mejora
 * por tener 200 ids. Se conserva SIEMPRE la raíz, que es la que identifica la factura.
 */
export function replyHeaders(
  rootMessageId: string,
  previousReferences?: string | null,
): { inReplyTo: string; references: string } {
  const chain = parseMessageIds(previousReferences)
  const withRoot = chain.includes(rootMessageId) ? chain : [rootMessageId, ...chain]
  const trimmed =
    withRoot.length <= 20 ? withRoot : [withRoot[0], ...withRoot.slice(withRoot.length - 19)]
  return {
    inReplyTo: withRoot[withRoot.length - 1] ?? rootMessageId,
    references: trimmed.join(" "),
  }
}

/**
 * Asunto de una respuesta: un solo `Re:`, no una escalera.
 *
 * Los clientes acumulan "Re: Re: RE: Re:" y eso además rompe el agrupado por asunto que hacen
 * algunos webmails como respaldo del hilado.
 */
export function replySubject(subject: string | null | undefined): string {
  const base = quitarPrefijos(subject)
  return base ? `Re: ${base}` : "Re:"
}

/**
 * El asunto sin la escalera de "Re: RE: Rv: Fwd:", CON su capitalización original.
 *
 * Separado de `asuntoBase` porque son dos usos incompatibles: esto se le MUESTRA al titular (y un
 * "Re: factura fv-100" en minúsculas se ve mal), mientras que aquello se COMPARA. Unificarlos
 * lowercaseaba el asunto de cada respuesta que sale — lo agarraron los tests de `replySubject`.
 */
function quitarPrefijos(subject: string | null | undefined): string {
  let s = (subject ?? "").trim()
  // Tope por si alguien manda un asunto que es sólo prefijos: no debe poder colgar el barrido.
  for (let i = 0; i < 20; i += 1) {
    const sin = s.replace(/^\s*(re|rv|fw|fwd)\s*:\s*/i, "")
    if (sin === s) break
    s = sin
  }
  return s.trim()
}

/**
 * El asunto sin ningún prefijo de respuesta ni reenvío, normalizado para comparar.
 *
 * Se usa para atribuir una respuesta a su factura cuando la fuente es la API del proveedor de correo
 * y no IMAP: ahí no llegan las cabeceras `References`/`In-Reply-To`, así que el asunto es lo único
 * que queda para emparejar. La escalera "Re: RE: Rv:" que acumulan los clientes se saca ENTERA —
 * `replySubject` quitaba un solo nivel porque sólo tenía que evitar generarla.
 *
 * Comparar con esto y no con el asunto crudo importa: `Factura FE-123` y `RE: Re: Factura FE-123`
 * son el mismo hilo, y un `full_number` es único por clínica, así que la colisión es improbable.
 */
export function asuntoBase(subject: string | null | undefined): string {
  return quitarPrefijos(subject).replace(/\s+/g, " ").toLowerCase()
}

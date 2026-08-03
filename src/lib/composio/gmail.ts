import "server-only"

// Correo de Athos vía Composio — la cuenta de Google que conecta CADA MIEMBRO.
//
// Es uno de los dos únicos caminos de correo del sistema (ver CORREOS.md): lo que manda una
// persona —o Athos por ella— sale de su propia cuenta. Lo que manda el sistema (facturas,
// cobranza, notificaciones) va por Resend y no pasa por acá.
//
// POR QUÉ EL SDK Y NO REST DIRECTO, que es el estilo del repo. Composio documenta el SDK y NO su
// API REST: la ejecución de tools no tiene endpoint publicado. Adivinar rutas y formas contra una
// API sin documentar es peor que una dependencia — y además el SDK trae los tipos, así que un
// cambio de forma lo caza `tsc` en vez del primer clic de un veterinario.
//
// La identidad: el `userId` de Composio es NUESTRO `profiles.id`. Así la conexión que hace un
// miembro es la que Athos usa cuando ese miembro le pide algo, sin tabla intermedia que sincronizar.

import { Composio } from "@composio/core"

/** Slug del toolkit. Microsoft queda para después; hoy solo Google. */
export const GMAIL_TOOLKIT = "gmail"

export const GMAIL_TOOLS = {
  enviar: "GMAIL_SEND_EMAIL",
  buscar: "GMAIL_FETCH_EMAILS",
} as const

function apiKey(): string | null {
  return process.env.COMPOSIO_API_KEY?.trim() || null
}

function authConfigId(): string | null {
  return process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID?.trim() || null
}

/**
 * Versión del toolkit de Gmail contra la que corren las tools.
 *
 * Fijada a propósito (ver el comentario en `composio()`). Las versiones disponibles se consultan
 * con `tools.getRawComposioToolBySlug("GMAIL_FETCH_EMAILS").availableVersions`.
 */
function gmailToolkitVersion(): string {
  return process.env.COMPOSIO_GMAIL_TOOLKIT_VERSION?.trim() || "20260721_00"
}

/** ¿Está Composio configurado en este despliegue? La UI lo usa para explicar en vez de fallar. */
export function composioConfigurado(): boolean {
  return apiKey() !== null && authConfigId() !== null
}

let cliente: Composio | null = null

function composio(): Composio {
  const key = apiKey()
  if (!key) {
    throw new Error("Falta COMPOSIO_API_KEY en el servidor: el correo de Athos no está disponible.")
  }
  // Una sola instancia por proceso: el SDK mantiene su propio cliente HTTP.
  //
  // `toolkitVersions` NO es opcional acá: ejecutar una tool a mano sin declarar versión falla con
  // ComposioToolVersionRequiredError. Y tiene que ser una versión CON FECHA — el propio SDK avisa
  // que "latest is not supported in manual execution", así que apuntar a la última no es opción.
  //
  // Quedar fijados a una fecha es lo correcto igual: la forma de la respuesta de una tool puede
  // cambiar entre versiones, y con "latest" ese cambio llegaría sin aviso a producción. Para
  // moverla se prueba la nueva y se actualiza acá (o se pisa con COMPOSIO_GMAIL_TOOLKIT_VERSION
  // para verificarla sin desplegar).
  cliente ??= new Composio({ apiKey: key, toolkitVersions: { [GMAIL_TOOLKIT]: gmailToolkitVersion() } })
  return cliente
}

export interface EstadoConexion {
  conectado: boolean
  /** Correo de la cuenta conectada, para mostrarlo en Conexiones. */
  email: string | null
}

/**
 * ¿Este miembro conectó su Gmail?
 *
 * Se pregunta a Composio en vez de guardar una copia nuestra: la conexión puede caerse del lado de
 * Google (el usuario revoca el acceso) y una tabla propia diría "conectado" para siempre. La
 * fuente de verdad es quien tiene el token.
 */
export async function estadoConexion(userId: string): Promise<EstadoConexion> {
  if (!composioConfigurado()) return { conectado: false, email: null }
  try {
    const { items } = await composio().connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: [GMAIL_TOOLKIT],
    })
    const activa = items.find((c) => c.status === "ACTIVE")
    if (!activa) return { conectado: false, email: null }
    // El correo de la cuenta viene en los datos del proveedor y su forma depende del toolkit; se
    // lee defensivamente porque no vale la pena romper la página por un dato decorativo.
    const datos = activa.data as Record<string, unknown> | undefined
    const email =
      typeof datos?.email === "string"
        ? datos.email
        : typeof datos?.user_email === "string"
          ? datos.user_email
          : null
    return { conectado: true, email }
  } catch (e) {
    console.error(`[composio/gmail] no se pudo consultar la conexión de ${userId}:`, e)
    return { conectado: false, email: null }
  }
}

/**
 * Empieza la conexión: devuelve la URL a la que hay que mandar al veterinario.
 *
 * Se usa `link()` y no `initiate()`: para auth configs administradas por Composio, `initiate()`
 * está retirado y responde 400 (el SDK tiene una excepción dedicada,
 * ComposioLegacyConnectedAccountsEndpointRetiredError).
 */
export async function iniciarConexion(userId: string, callbackUrl: string): Promise<string> {
  const auth = authConfigId()
  if (!auth) {
    throw new Error("Falta COMPOSIO_GMAIL_AUTH_CONFIG_ID en el servidor.")
  }
  try {
    const request = await composio().connectedAccounts.link(userId, auth, { callbackUrl })
    if (!request.redirectUrl) {
      throw new Error("Composio no devolvió una URL de autorización.")
    }
    return request.redirectUrl
  } catch (e) {
    throw new Error(explicarFalloDeConexion(e))
  }
}

/**
 * Traduce el fallo de `link()` a algo accionable.
 *
 * El SDK envuelve todo en "Failed to create connected account link" y esconde la causa real en
 * `cause` — que no le dice nada a nadie. El primer intento contra la API real falló justamente por
 * una key de SOLO LECTURA, y ese mensaje genérico habría mandado a buscar el problema al código.
 */
function explicarFalloDeConexion(e: unknown): string {
  const causa = (e as { cause?: { error?: { error?: { slug?: string; message?: string } } } })?.cause
  const detalle = causa?.error?.error
  if (detalle?.slug === "APIKey_InsufficientPermissions") {
    return 'La API key de Composio es de solo lectura. En el dashboard de Composio dale permiso de ESCRITURA sobre "connected_accounts" (o usá una key que ya lo tenga).'
  }
  if (detalle?.message) return `Composio rechazó la conexión: ${detalle.message}`
  return e instanceof Error ? e.message : "No se pudo iniciar la conexión con Composio."
}

/** Desconecta: borra la cuenta conectada de ese miembro. */
export async function desconectar(userId: string): Promise<void> {
  const { items } = await composio().connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: [GMAIL_TOOLKIT],
  })
  for (const cuenta of items) {
    await composio().connectedAccounts.delete(cuenta.id)
  }
}

export type ResultadoTool =
  | { ok: true; data: unknown }
  | { ok: false; error: string; sinConectar?: boolean }

/** Un correo, ya normalizado para la bandeja. */
export interface CorreoBandeja {
  id: string
  threadId: string
  de: string
  para: string
  asunto: string
  preview: string
  fecha: string
  /** Lo que salió de esta cuenta, para pintarlo del otro lado de la conversación. */
  esPropio: boolean
  leido: boolean
  adjuntos: number
}

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

function normalizar_(m: MensajeGmail): CorreoBandeja {
  const labels = m.labelIds ?? []
  return {
    id: m.messageId ?? "",
    threadId: m.threadId ?? m.messageId ?? "",
    de: m.sender ?? "(desconocido)",
    para: m.to ?? "",
    asunto: m.subject ?? "(sin asunto)",
    preview: (m.preview?.body ?? m.messageText ?? "").slice(0, 200),
    fecha: m.messageTimestamp ?? new Date().toISOString(),
    // Gmail etiqueta lo enviado con SENT: es más fiable que comparar direcciones, porque el vet
    // puede tener alias y el `sender` viene como "Nombre <correo>".
    esPropio: labels.includes("SENT"),
    leido: !labels.includes("UNREAD"),
    adjuntos: (m.attachmentList ?? []).length,
  }
}

/**
 * Trae correos de la cuenta del miembro, ya normalizados.
 *
 * Se lee EN VIVO contra Gmail en vez de mantener una copia en nuestra base. Es lo que evita todo
 * el aparato que hacía falta antes —barrido periódico, deduplicación, hilado, realtime— y, sobre
 * todo, evita guardar el correo de la clínica en nuestros servidores: menos superficie bajo la Ley
 * 1581. La contrapartida es que la bandeja tarda lo que tarde Gmail en responder.
 */
export async function listarBandeja(
  userId: string,
  opciones: { query?: string; limite?: number } = {},
): Promise<{ ok: true; correos: CorreoBandeja[] } | { ok: false; error: string; sinConectar?: boolean }> {
  const r = await ejecutarGmail(userId, GMAIL_TOOLS.buscar, {
    max_results: opciones.limite ?? 25,
    ...(opciones.query ? { query: opciones.query } : {}),
  })
  if (!r.ok) return r
  const data = r.data as { messages?: MensajeGmail[] } | undefined
  const correos = (data?.messages ?? []).map(normalizar_)
  return { ok: true, correos }
}

/**
 * Ejecuta una tool de Gmail con la cuenta de ese miembro.
 *
 * Devuelve un resultado en vez de lanzar: quien llama es una tool de Athos, y un error tiene que
 * volver al modelo como texto ("no tenés el correo conectado") para que se lo diga al vet, no
 * tumbar el turno del agente.
 */
export async function ejecutarGmail(
  userId: string,
  slug: string,
  args: Record<string, unknown>,
): Promise<ResultadoTool> {
  if (!composioConfigurado()) {
    return { ok: false, error: "El correo por Composio no está configurado en este servidor." }
  }
  try {
    const r = await composio().tools.execute(slug, { userId, arguments: args })
    if (!r.successful) {
      return { ok: false, error: r.error ?? "Gmail rechazó la operación." }
    }
    return { ok: true, data: r.data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido"
    // El caso más común y el único con una acción clara del lado del vet: nunca conectó la cuenta.
    if (/no connected account|not connected|connected account not found/i.test(msg)) {
      return {
        ok: false,
        error: "No tenés tu correo conectado. Se conecta en Conexiones → Correo de Athos.",
        sinConectar: true,
      }
    }
    console.error(`[composio/gmail] ${slug} falló para ${userId}:`, msg)
    return { ok: false, error: msg }
  }
}

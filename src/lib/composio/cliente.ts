import "server-only"

// El cliente de Composio y las tres cosas que costó descubrir cómo usarlo. Lo comparten el correo
// (`correo.ts`) y el calendario (`calendario.ts`): son integraciones distintas contra la misma API,
// y sin esto cada una volvería a tropezar con lo mismo.
//
// POR QUÉ EL SDK Y NO REST, que es el estilo del repo: Composio documenta el SDK y NO la ejecución
// de tools por REST. Adivinar rutas contra una API sin documentar es peor que una dependencia — y
// el SDK trae los tipos, así que un cambio de forma lo caza `tsc` y no el primer clic de un vet.
//
// La identidad: el `userId` de Composio es NUESTRO `profiles.id`. Por eso la cuenta que conecta una
// persona es la que se usa cuando esa persona pide algo, sin tabla intermedia que sincronizar.

import { Composio } from "@composio/core"

/**
 * Versión fija de cada toolkit, en un solo lugar.
 *
 * NO es opcional: ejecutar una tool a mano sin declarar versión falla con
 * ComposioToolVersionRequiredError, y tiene que ser una versión CON FECHA — el propio SDK avisa que
 * "latest is not supported in manual execution". La versión *default* de un toolkit (`00000000_00`)
 * tampoco sirve para esto: es la que se mueve sola, así que un cambio en la forma de la respuesta
 * llegaría a producción sin aviso.
 *
 * Todas verificadas contra la API el 2026-08-03; las disponibles salen del campo `available_versions`
 * de la definición de cualquier tool del toolkit.
 */
export const VERSIONES_DE_TOOLKIT: Record<string, string> = {
  gmail: process.env.COMPOSIO_GMAIL_TOOLKIT_VERSION?.trim() || "20260721_00",
  outlook: process.env.COMPOSIO_OUTLOOK_TOOLKIT_VERSION?.trim() || "20251016_01",
  googlecalendar: process.env.COMPOSIO_GOOGLECALENDAR_TOOLKIT_VERSION?.trim() || "20260721_00",
}

export function apiKey(): string | null {
  return process.env.COMPOSIO_API_KEY?.trim() || null
}

let cliente: Composio | null = null

/** Una sola instancia por proceso: el SDK mantiene su propio cliente HTTP. */
export function composio(): Composio {
  const key = apiKey()
  if (!key) throw new Error("Falta COMPOSIO_API_KEY en el servidor.")
  cliente ??= new Composio({ apiKey: key, toolkitVersions: VERSIONES_DE_TOOLKIT })
  return cliente
}

/**
 * El error REAL que devolvió Composio, que el SDK entierra en `cause`.
 *
 * Lo que llega en `Error.message` es un cartel fijo por operación —"Failed to create connected
 * account link", "Error executing the tool X"— que no distingue una causa de otra. El `slug` de acá
 * es lo único con lo que se puede ramificar; se lee defensivamente porque es estructura interna del
 * SDK y no parte de su contrato.
 */
export function detalleDelFallo(e: unknown): { slug?: string; message?: string } | null {
  const causa = (e as { cause?: { error?: { error?: { slug?: string; message?: string } } } })?.cause
  return causa?.error?.error ?? null
}

/**
 * Traduce el fallo de `link()` a algo accionable.
 *
 * El SDK envuelve todo en "Failed to create connected account link" y esconde la causa real. El
 * primer intento contra la API real falló justamente por una key de SOLO LECTURA, y ese mensaje
 * genérico habría mandado a buscar el problema al código.
 */
export function explicarFalloDeConexion(e: unknown): string {
  const detalle = detalleDelFallo(e)
  if (detalle?.slug === "APIKey_InsufficientPermissions") {
    return 'La API key de Composio es de solo lectura. En el dashboard de Composio dale permiso de ESCRITURA sobre "connected_accounts" (o usá una key que ya lo tenga).'
  }
  if (detalle?.message) return `Composio rechazó la conexión: ${detalle.message}`
  return e instanceof Error ? e.message : "No se pudo iniciar la conexión con Composio."
}

export type ResultadoTool =
  | { ok: true; data: unknown }
  | { ok: false; error: string; sinConectar?: boolean }

/** Ejecuta una tool con la cuenta de un miembro. No lanza: el error vuelve como dato. */
export async function ejecutarTool(
  userId: string,
  slug: string,
  args: Record<string, unknown>,
): Promise<ResultadoTool> {
  if (!apiKey()) {
    return { ok: false, error: "Composio no está configurado en este servidor." }
  }
  try {
    const r = await composio().tools.execute(slug, { userId, arguments: args })
    if (!r.successful) return { ok: false, error: r.error ?? "El proveedor rechazó la operación." }
    return { ok: true, data: r.data }
  } catch (e) {
    const detalle = detalleDelFallo(e)
    // El slug es la vía fiable: buscar texto en el `message` no encuentra nunca la causa, porque
    // ese mensaje es el mismo cartel genérico para todo fallo de ejecución.
    if (detalle?.slug === "ActionExecute_ConnectedAccountNotFound") {
      return { ok: false, error: "Esa cuenta no está conectada.", sinConectar: true }
    }
    const msg = detalle?.message ?? (e instanceof Error ? e.message : "Error desconocido")
    console.error(`[composio] ${slug} falló para ${userId}:`, msg)
    return { ok: false, error: msg }
  }
}

/** Las cuentas conectadas de un miembro para esos toolkits. */
export async function cuentasDe(userId: string, toolkits: string[]) {
  const { items } = await composio().connectedAccounts.list({ userIds: [userId], toolkitSlugs: toolkits })
  return items
}

/**
 * Empieza una conexión: devuelve la URL a la que hay que mandar a la persona.
 *
 * Se usa `link()` y no `initiate()`: para auth configs administradas por Composio, `initiate()`
 * está retirado y responde 400 (el SDK tiene una excepción dedicada).
 */
export async function enlazar(
  userId: string,
  authConfigId: string,
  callbackUrl: string,
): Promise<string> {
  try {
    const request = await composio().connectedAccounts.link(userId, authConfigId, { callbackUrl })
    if (!request.redirectUrl) throw new Error("Composio no devolvió una URL de autorización.")
    return request.redirectUrl
  } catch (e) {
    throw new Error(explicarFalloDeConexion(e))
  }
}

/** Borra las cuentas conectadas de un miembro para esos toolkits. */
export async function desconectarDe(userId: string, toolkits: string[]): Promise<void> {
  for (const cuenta of await cuentasDe(userId, toolkits)) {
    await composio().connectedAccounts.delete(cuenta.id)
  }
}

import "server-only"

// Correo de Athos vía Composio — la cuenta que conecta CADA MIEMBRO, sea Gmail u Outlook.
//
// Es uno de los dos únicos caminos de correo del sistema (ver CORREOS.md): lo que manda una
// persona —o Athos por ella— sale de su propia cuenta. Lo que manda el sistema (facturas,
// cobranza, notificaciones) va por Resend y no pasa por acá.
//
// Las diferencias entre proveedores viven en `proveedores.ts`; este archivo no las conoce. Acá está
// lo común: quién está conectado, cómo se conecta, y cómo se ejecuta una operación con su cuenta.
//
// POR QUÉ EL SDK Y NO REST, que es el estilo del repo: Composio documenta el SDK y NO la ejecución
// de tools por REST. Adivinar rutas contra una API sin documentar es peor que una dependencia — y
// el SDK trae los tipos, así que un cambio de forma lo caza `tsc` y no el primer clic de un vet.
//
// La identidad: el `userId` de Composio es NUESTRO `profiles.id`. Por eso la cuenta que conecta un
// miembro es la que Athos usa cuando ese miembro le pide algo, sin tabla intermedia que sincronizar.

import { Composio } from "@composio/core"

import {
  adaptador,
  proveedoresDisponibles,
  type CorreoNormalizado,
  type Proveedor,
} from "./proveedores"

export { NOMBRE_PROVEEDOR, type CorreoNormalizado, type Proveedor } from "./proveedores"
export { proveedoresDisponibles } from "./proveedores"

function apiKey(): string | null {
  return process.env.COMPOSIO_API_KEY?.trim() || null
}

/** ¿Hay al menos un proveedor de correo utilizable en este despliegue? */
export function composioConfigurado(): boolean {
  return apiKey() !== null && proveedoresDisponibles().length > 0
}

let cliente: Composio | null = null

function composio(): Composio {
  const key = apiKey()
  if (!key) {
    throw new Error("Falta COMPOSIO_API_KEY en el servidor: el correo de Athos no está disponible.")
  }
  // Una sola instancia por proceso: el SDK mantiene su propio cliente HTTP.
  //
  // `toolkitVersions` NO es opcional: ejecutar una tool a mano sin declarar versión falla con
  // ComposioToolVersionRequiredError, y tiene que ser una versión CON FECHA — el propio SDK avisa
  // que "latest is not supported in manual execution".
  //
  // Quedar fijados a una versión es lo correcto igual: la forma de la respuesta puede cambiar entre
  // versiones y con "latest" ese cambio llegaría a producción sin aviso.
  const versiones = Object.fromEntries(
    proveedoresDisponibles().map((p) => [adaptador(p).toolkit, adaptador(p).version]),
  )
  cliente ??= new Composio({ apiKey: key, toolkitVersions: versiones })
  return cliente
}

export interface EstadoConexion {
  conectado: boolean
  /** Con cuál de los dos, si hay alguno. */
  proveedor: Proveedor | null
  /** Correo de la cuenta conectada, para mostrarlo en Conexiones. */
  email: string | null
}

/**
 * ¿Este miembro conectó su correo, y con qué proveedor?
 *
 * Se le pregunta a Composio en vez de guardar una copia nuestra: la conexión puede caerse del lado
 * del proveedor (el usuario revoca el acceso) y una tabla propia diría "conectado" para siempre. La
 * fuente de verdad es quien tiene el token.
 */
export async function estadoConexion(userId: string): Promise<EstadoConexion> {
  const sinConexion: EstadoConexion = { conectado: false, proveedor: null, email: null }
  if (!composioConfigurado()) return sinConexion
  try {
    const { items } = await composio().connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: proveedoresDisponibles().map((p) => adaptador(p).toolkit),
    })
    const activa = items.find((c) => c.status === "ACTIVE")
    if (!activa) return sinConexion

    const slug = activa.toolkit?.slug
    const proveedor = proveedoresDisponibles().find((p) => adaptador(p).toolkit === slug) ?? null

    // El correo de la cuenta viene en los datos del proveedor y su forma depende del toolkit: Google
    // lo llama `email`, Microsoft Graph `mail` o `userPrincipalName`. Se prueban todos en vez de
    // ramificar por proveedor — es un dato decorativo y no vale romper la página por un nombre.
    const datos = (activa.data ?? {}) as Record<string, unknown>
    const email =
      ["email", "user_email", "mail", "userPrincipalName"]
        .map((k) => datos[k])
        .find((v): v is string => typeof v === "string" && v.includes("@")) ?? null
    return { conectado: true, proveedor, email }
  } catch (e) {
    console.error(`[composio/correo] no se pudo consultar la conexión de ${userId}:`, e)
    return sinConexion
  }
}

/**
 * Empieza la conexión: devuelve la URL a la que hay que mandar al veterinario.
 *
 * Se usa `link()` y no `initiate()`: para auth configs administradas por Composio, `initiate()`
 * está retirado y responde 400 (el SDK tiene una excepción dedicada).
 */
export async function iniciarConexion(
  userId: string,
  proveedor: Proveedor,
  callbackUrl: string,
): Promise<string> {
  const a = adaptador(proveedor)
  const auth = (process.env[a.envAuthConfig] ?? "").trim()
  if (!auth) {
    throw new Error(`Falta ${a.envAuthConfig} en el servidor.`)
  }
  try {
    const request = await composio().connectedAccounts.link(userId, auth, { callbackUrl })
    if (!request.redirectUrl) throw new Error("Composio no devolvió una URL de autorización.")
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

/** Desconecta: borra las cuentas de correo conectadas de ese miembro. */
export async function desconectar(userId: string): Promise<void> {
  const { items } = await composio().connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: proveedoresDisponibles().map((p) => adaptador(p).toolkit),
  })
  for (const cuenta of items) {
    await composio().connectedAccounts.delete(cuenta.id)
  }
}

export type ResultadoCorreo =
  | { ok: true; data: unknown }
  | { ok: false; error: string; sinConectar?: boolean }

/** Ejecuta una tool con la cuenta del miembro. No lanza: el error vuelve al modelo como texto. */
async function ejecutar(
  userId: string,
  slug: string,
  args: Record<string, unknown>,
): Promise<ResultadoCorreo> {
  if (!composioConfigurado()) {
    return { ok: false, error: "El correo por Composio no está configurado en este servidor." }
  }
  try {
    const r = await composio().tools.execute(slug, { userId, arguments: args })
    if (!r.successful) return { ok: false, error: r.error ?? "El proveedor rechazó la operación." }
    return { ok: true, data: r.data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido"
    if (/no connected account|not connected|connected account not found/i.test(msg)) {
      return {
        ok: false,
        error: "No tenés tu correo conectado. Se conecta en Conexiones → Correo de Athos.",
        sinConectar: true,
      }
    }
    console.error(`[composio/correo] ${slug} falló para ${userId}:`, msg)
    return { ok: false, error: msg }
  }
}

/**
 * Resuelve con qué proveedor opera este miembro.
 *
 * Cada operación arranca por acá: sin saber si conectó Gmail u Outlook no se puede elegir la tool
 * ni los nombres de los parámetros.
 */
async function conProveedor(
  userId: string,
): Promise<{ ok: true; proveedor: Proveedor; email: string | null } | { ok: false; error: string; sinConectar: true }> {
  const estado = await estadoConexion(userId)
  if (!estado.conectado || !estado.proveedor) {
    return {
      ok: false,
      sinConectar: true,
      error: "No tenés tu correo conectado. Se conecta en Conexiones → Correo de Athos.",
    }
  }
  return { ok: true, proveedor: estado.proveedor, email: estado.email }
}

/** Busca correos en la cuenta del miembro, ya normalizados. */
export async function buscarCorreos(
  userId: string,
  opciones: { query?: string; limite?: number } = {},
): Promise<{ ok: true; correos: CorreoNormalizado[] } | { ok: false; error: string; sinConectar?: boolean }> {
  const quien = await conProveedor(userId)
  if (!quien.ok) return quien

  const a = adaptador(quien.proveedor)
  const { slug, args } = a.buscar(opciones.query ?? "", opciones.limite ?? 25)
  const r = await ejecutar(userId, slug, args)
  if (!r.ok) return r
  return { ok: true, correos: a.normalizar(r.data, quien.email) }
}

/** Envía un correo NUEVO desde la cuenta del miembro. */
export async function enviarCorreo(
  userId: string,
  input: { a: string; asunto: string; cuerpo: string },
): Promise<ResultadoCorreo> {
  const quien = await conProveedor(userId)
  if (!quien.ok) return quien
  const { slug, args } = adaptador(quien.proveedor).enviar(input.a, input.asunto, input.cuerpo)
  return ejecutar(userId, slug, args)
}

/**
 * Responde DENTRO de una conversación existente.
 *
 * `ref` es lo que cada proveedor necesita para hilar: el id del hilo en Gmail, el del mensaje en
 * Outlook. Sale de `CorreoNormalizado.refRespuesta`, justamente para no tener que saber cuál es.
 */
export async function responderCorreo(
  userId: string,
  input: { ref: string; a: string; asunto: string; cuerpo: string },
): Promise<ResultadoCorreo> {
  const quien = await conProveedor(userId)
  if (!quien.ok) return quien
  const { slug, args } = adaptador(quien.proveedor).responder(input)
  return ejecutar(userId, slug, args)
}

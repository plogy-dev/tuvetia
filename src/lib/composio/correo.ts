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

import {
  apiKey,
  cuentasDe,
  desconectarDe,
  ejecutarTool,
  enlazar,
  type ResultadoTool,
} from "./cliente"

import {
  adaptador,
  destinatarioEnHilo,
  direccionDelPerfil,
  proveedoresDisponibles,
  type CorreoNormalizado,
  type Proveedor,
} from "./proveedores"

export { NOMBRE_PROVEEDOR, type CorreoNormalizado, type Proveedor } from "./proveedores"
export { avisoDeEntrega, proveedoresDisponibles } from "./proveedores"

/** ¿Hay al menos un proveedor de correo utilizable en este despliegue? */
export function composioConfigurado(): boolean {
  return apiKey() !== null && proveedoresDisponibles().length > 0
}

export interface EstadoConexion {
  conectado: boolean
  /** Con cuál de los dos, si hay alguno. */
  proveedor: Proveedor | null
  /** Dirección desde la que se envía. Null si el perfil no se pudo consultar. */
  email: string | null
}

/**
 * La dirección de cada miembro, cacheada por proceso.
 *
 * Sacarla cuesta una llamada al proveedor (ningún dato de la cuenta conectada la trae), y
 * `estadoConexion` se llama en cada carga de página y antes de cada propuesta de correo. La
 * dirección de una cuenta no cambia, así que preguntarla una vez por instancia alcanza.
 */
const direcciones = new Map<string, string | null>()

async function direccionDe(userId: string, proveedor: Proveedor): Promise<string | null> {
  const clave = `${proveedor}:${userId}`
  const cacheada = direcciones.get(clave)
  if (cacheada !== undefined) return cacheada

  const { slug, args } = adaptador(proveedor).perfil()
  const r = await ejecutar(userId, slug, args)
  const email = r.ok ? direccionDelPerfil(r.data) : null
  // Un fallo NO se cachea: puede ser transitorio y dejaría la dirección en null para siempre.
  if (email) direcciones.set(clave, email)
  return email
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
    const items = await cuentasDe(userId, proveedoresDisponibles().map((p) => adaptador(p).toolkit))
    const activa = items.find((c) => c.status === "ACTIVE")
    if (!activa) return sinConexion

    const slug = activa.toolkit?.slug
    const proveedor = proveedoresDisponibles().find((p) => adaptador(p).toolkit === slug) ?? null
    if (!proveedor) return sinConexion

    // La dirección NO es un dato decorativo: es desde dónde sale el correo. Antes se intentaba leer
    // de los datos de la cuenta conectada, donde ningún proveedor la pone — siempre daba null, así
    // que Conexiones no mostraba nada y nadie podía notar que la cuenta enviaba desde una dirección
    // que no puede entregar.
    return { conectado: true, proveedor, email: await direccionDe(userId, proveedor) }
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
  // Uno de los dos, no los dos. `estadoConexion` toma la primera cuenta ACTIVA que encuentra, así
  // que con Gmail y Outlook conectados a la vez el correo saldría de una u otra sin que nadie lo
  // haya decidido. Conectar es entonces también cambiar: se limpia lo anterior primero.
  await desconectar(userId).catch((e) => {
    console.error(`[composio/correo] no se pudo limpiar la conexión previa de ${userId}:`, e)
  })
  direcciones.delete(`gmail:${userId}`)
  direcciones.delete(`outlook:${userId}`)

  return enlazar(userId, auth, callbackUrl)
}

/** Desconecta: borra las cuentas de correo conectadas de ese miembro. */
export async function desconectar(userId: string): Promise<void> {
  direcciones.delete(`gmail:${userId}`)
  direcciones.delete(`outlook:${userId}`)
  await desconectarDe(userId, proveedoresDisponibles().map((p) => adaptador(p).toolkit))
}

export type ResultadoCorreo = ResultadoTool

/** Ejecuta con la cuenta del miembro, traduciendo "no conectada" al idioma del correo. */
async function ejecutar(
  userId: string,
  slug: string,
  args: Record<string, unknown>,
): Promise<ResultadoCorreo> {
  const r = await ejecutarTool(userId, slug, args)
  if (!r.ok && r.sinConectar) {
    return { ...r, error: "No tenés tu correo conectado. Se conecta en Conexiones → Correo de Athos." }
  }
  return r
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

/**
 * Trae una conversación entera, ya normalizada.
 *
 * `ref` es un `refConversacion` (lo que devuelve la búsqueda), NO el id con el que se responde: en
 * Outlook son ids distintos y pedir el hilo con el del mensaje no devuelve nada.
 */
export async function leerConversacion(
  userId: string,
  ref: string,
): Promise<{ ok: true; correos: CorreoNormalizado[] } | { ok: false; error: string; sinConectar?: boolean }> {
  const quien = await conProveedor(userId)
  if (!quien.ok) return quien
  const a = adaptador(quien.proveedor)
  const { slug, args } = a.buscarConversacion(ref)
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

/**
 * ¿La dirección a la que se va a responder participa REALMENTE de esa conversación?
 *
 * POR QUÉ EXISTE. Al pasar el correo a Composio, `to_email` dejó de resolverlo el ejecutor desde
 * nuestra tabla de hilos y pasó a viajar en el payload: lo propone el MODELO y la tarjeta deja
 * editarlo. Eso abre una vía concreta — un correo entrante con instrucciones inyectadas puede lograr
 * que Athos proponga responder a otra dirección, y un vet apurado aprueba sin leerla. Resaltarla en
 * la tarjeta ayuda, pero apoyar la defensa en que alguien lea bien es no tener defensa.
 *
 * Con Outlook el problema no existe: su tool de respuesta no acepta destinatario, lo resuelve Graph
 * desde el mensaje original. Ahí no hay nada que verificar porque no hay nada que redirigir — y
 * pedirle el hilo igual sería una llamada de red para confirmar algo que la API ya garantiza.
 */
export async function verificarDestinatarioDeRespuesta(
  userId: string,
  ref: string,
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const quien = await conProveedor(userId)
  if (!quien.ok) return { ok: false, error: quien.error }

  const a = adaptador(quien.proveedor)
  if (a.respuestaFijaDestinatario) return { ok: true }

  const { slug, args } = a.buscarConversacion(ref)
  const hilo = await ejecutar(userId, slug, args)
  if (!hilo.ok) {
    return { ok: false, error: `No se pudo verificar el hilo antes de responder: ${hilo.error}` }
  }
  if (!destinatarioEnHilo(email, hilo.data)) {
    return {
      ok: false,
      error: `${email} no participa de este hilo, así que la respuesta no se envió. Si querés escribirle, usá un correo nuevo en vez de una respuesta.`,
    }
  }
  return { ok: true }
}

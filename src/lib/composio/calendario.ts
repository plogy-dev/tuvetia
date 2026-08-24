import "server-only"

// Calendario vía Composio — Google Calendar u Outlook Calendar.
//
// Reemplaza al OAuth propio (`google-calendar.ts` / `microsoft-calendar.ts`), que guardaba un
// refresh token por usuario en `calendar_integrations` y lo refrescaba a mano. Ese camino traía todo
// lo que Composio resuelve: credenciales del servidor que mantener, tokens nuestros en la base, y el
// refresh fallando con `invalid_grant` cada vez que el proveedor revocaba algo.
//
// LAS DOS REGLAS DEL CALENDARIO, que es lo que hay que preservar al leer este archivo:
//
//   1. UNA SOLA VÍA. Tuvetia EMPUJA sus citas; no lee nada de vuelta. El *pull* que existió trajo el
//      calendario personal de un vet —19.649 filas "Comer"/"Trabajo"/"Dormir" contra 21 citas
//      reales— a la agenda de la clínica. Sin lectura ese problema no puede repetirse: no es un
//      filtro mejor, es que el canal no existe. Por eso acá sólo hay crear, actualizar y borrar.
//   2. EL EVENTO VIVE EN EL CALENDARIO DEL VETERINARIO ASIGNADO (v5), con el administrador de la
//      clínica como respaldo si esa persona no conectó el suyo. Y van INVITADOS el titular, TODOS
//      los administradores y quien creó la cita.
//
//      v3 ya había puesto el evento en el calendario del vet y se revirtió porque el administrador
//      no lo veía en ningún lado — se reportó como "no crea nada" cuando sí creaba. Lo que arregla
//      eso no es devolverle el evento al admin (v4): es invitarlos a todos. Así el admin sigue
//      teniendo la clínica entera en su calendario y el vet además tiene la suya. Quién hospeda y
//      quién va invitado se decide en `lib/agenda/destinatarios.ts`, que es puro y está probado.
//
// OJO CON MICROSOFT: el calendario de Outlook vive en el MISMO toolkit que el correo de Outlook, así
// que una sola cuenta conectada sirve para los dos. Conectar o desconectar Microsoft afecta a ambos,
// y eso tiene que quedar dicho en la pantalla — no es un detalle de implementación.

import { quienTieneElCalendario } from "@/lib/calendario/quien-lo-tiene"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  candidatosAAnfitrion,
  correosDeInvitados,
  direccionDeLaClinica,
  perfilesAInvitar,
} from "@/lib/agenda/destinatarios"

import { cuentasDe, desconectarDe, ejecutarTool, enlazar } from "./cliente"

export type ProveedorCalendario = "google" | "outlook"

export const NOMBRE_CALENDARIO: Record<ProveedorCalendario, string> = {
  google: "Google Calendar",
  outlook: "Outlook Calendar",
}

/** Un evento tal como lo entiende Tuvetia, antes de traducirlo a la tool de cada proveedor. */
export interface EventoACrear {
  titulo: string
  descripcion?: string
  /** ISO con zona (lo que guarda Postgres en un timestamptz). */
  inicio: string
  fin: string
  invitados: string[]
  /**
   * La dirección de la clínica. Va al campo de ubicación del evento, que es lo que el teléfono del
   * titular convierte en un enlace a mapas.
   *
   * SE MANDA ADEMÁS EN EL CUERPO (ver `eventoDe`), y es a propósito: `location` es el único
   * parámetro de esta capa que NO pudimos verificar contra la API —las dos tools lo declaran, pero
   * el resto de este archivo salió de probar cada nombre contra el proveedor y esto no— así que si
   * alguno lo ignora, la dirección igual le llega al titular. Una invitación sin dirección es
   * exactamente el problema que este campo vino a resolver; que aparezca dos veces, no.
   */
  ubicacion?: string
}

interface AdaptadorCalendario {
  toolkit: string
  envAuthConfig: string
  /** Columna de `appointments` donde vive el id del evento de este proveedor. */
  columnaEvento: "google_event_id" | "microsoft_event_id"
  /**
   * ¿Esta conexión también da correo?
   *
   * Microsoft usa un solo toolkit para calendario y correo, así que desconectar el calendario le
   * saca el correo a Athos. Se declara acá para que la UI pueda advertirlo en vez de sorprender.
   */
  compartidoConElCorreo: boolean
  crear(e: EventoACrear): { slug: string; args: Record<string, unknown> }
  actualizar(eventId: string, e: EventoACrear): { slug: string; args: Record<string, unknown> }
  borrar(eventId: string): { slug: string; args: Record<string, unknown> }
  /** El id del evento creado, sacado de la respuesta. Null si no se pudo leer. */
  idDelEvento(data: unknown): string | null
}

/**
 * El id del evento en la respuesta del proveedor.
 *
 * Los dos devuelven el recurso creado con su `id` dentro de `response_data`, pero ninguno DECLARA la
 * forma en su esquema de salida, así que se lee defensivamente.
 */
function idEnRespuesta(data: unknown): string | null {
  const raiz = (data as { response_data?: unknown })?.response_data ?? data
  const d = (raiz ?? {}) as Record<string, unknown>
  for (const v of [d.id, (d.event as Record<string, unknown> | undefined)?.id, d.event_id]) {
    if (typeof v === "string" && v) return v
  }
  return null
}

/**
 * Fecha en el formato que piden las tools: `YYYY-MM-DDTHH:MM:SS`, sin zona.
 *
 * Se manda en UTC y con la zona aparte. Las dos aceptan una fecha "naive" más una zona, así que
 * mandar el instante en UTC es lo único que no depende de dónde corra el servidor ni de si Colombia
 * cambió de offset.
 */
function fechaSinZona(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19)
}

// ─── Google Calendar ──────────────────────────────────────────────────────────

function argsDeGoogle(e: EventoACrear): Record<string, unknown> {
  return {
    calendar_id: "primary",
    summary: e.titulo,
    ...(e.descripcion ? { description: e.descripcion } : {}),
    ...(e.ubicacion ? { location: e.ubicacion } : {}),
    start_datetime: fechaSinZona(e.inicio),
    end_datetime: fechaSinZona(e.fin),
    timezone: "UTC",
    ...(e.invitados.length ? { attendees: e.invitados } : {}),
    // Que al titular le llegue la invitación es el punto de empujar la cita: sin esto el evento
    // aparece en el calendario y el cliente no se entera de nada.
    send_updates: "all",
  }
}

const GOOGLE: AdaptadorCalendario = {
  toolkit: "googlecalendar",
  envAuthConfig: "COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID",
  columnaEvento: "google_event_id",
  compartidoConElCorreo: false,

  crear: (e) => ({ slug: "GOOGLECALENDAR_CREATE_EVENT", args: argsDeGoogle(e) }),
  actualizar: (eventId, e) => ({
    slug: "GOOGLECALENDAR_UPDATE_EVENT",
    args: { ...argsDeGoogle(e), event_id: eventId },
  }),
  borrar: (eventId) => ({
    slug: "GOOGLECALENDAR_DELETE_EVENT",
    args: { calendar_id: "primary", event_id: eventId },
  }),
  idDelEvento: idEnRespuesta,
}

// ─── Outlook Calendar ─────────────────────────────────────────────────────────
//
// Crear y actualizar NO comparten forma, aunque sean el mismo proveedor (verificado contra la API el
// 2026-08-03). Es exactamente el tipo de diferencia por la que existe esta capa:
//
//   - invitados: `attendees_info: [{email}]` al crear, `attendees: [{emailAddress:{address}, type}]`
//     al actualizar;
//   - cuerpo: `body` string + `is_html` al crear, `body: {contentType, content}` al actualizar.

const OUTLOOK: AdaptadorCalendario = {
  toolkit: "outlook",
  envAuthConfig: "COMPOSIO_OUTLOOK_AUTH_CONFIG_ID",
  columnaEvento: "microsoft_event_id",
  // El calendario y el correo de Outlook son el mismo toolkit y la misma cuenta conectada.
  compartidoConElCorreo: true,

  crear: (e) => ({
    slug: "OUTLOOK_OUTLOOK_CALENDAR_CREATE_EVENT",
    args: {
      subject: e.titulo,
      // `body` es obligatorio: mandar el título cuando no hay motivo ni notas evita que Graph
      // rechace la cita por un campo vacío.
      body: e.descripcion || e.titulo,
      is_html: false,
      ...(e.ubicacion ? { location: e.ubicacion } : {}),
      start_datetime: fechaSinZona(e.inicio),
      end_datetime: fechaSinZona(e.fin),
      time_zone: "UTC",
      ...(e.invitados.length
        ? { attendees_info: e.invitados.map((email) => ({ email, type: "required" })) }
        : {}),
    },
  }),
  actualizar: (eventId, e) => ({
    slug: "OUTLOOK_OUTLOOK_UPDATE_CALENDAR_EVENT",
    args: {
      event_id: eventId,
      subject: e.titulo,
      body: { contentType: "Text", content: e.descripcion || e.titulo },
      ...(e.ubicacion ? { location: e.ubicacion } : {}),
      start_datetime: fechaSinZona(e.inicio),
      end_datetime: fechaSinZona(e.fin),
      time_zone: "UTC",
      // La lista REEMPLAZA a los invitados actuales, así que se manda entera siempre — mandar sólo
      // los nuevos borraría a los demás.
      attendees: e.invitados.map((address) => ({ emailAddress: { address }, type: "required" })),
    },
  }),
  borrar: (eventId) => ({
    slug: "OUTLOOK_OUTLOOK_DELETE_EVENT",
    args: { event_id: eventId, send_notifications: true },
  }),
  idDelEvento: idEnRespuesta,
}

// El orden importa: si alguien tiene los dos, manda Google Calendar. Conectar Google Calendar es un
// acto explícito para el calendario, mientras que la cuenta de Outlook puede existir sólo porque se
// conectó el CORREO — y elegirla ahí sería mandarle las citas a un calendario que nadie pidió.
const ADAPTADORES: Record<ProveedorCalendario, AdaptadorCalendario> = {
  google: GOOGLE,
  outlook: OUTLOOK,
}
const ORDEN: ProveedorCalendario[] = ["google", "outlook"]

/** Para los tests: la traducción a la tool es lo único de acá que se puede probar sin red. */
export function adaptadorCalendario(p: ProveedorCalendario): AdaptadorCalendario {
  return ADAPTADORES[p]
}

/** Los proveedores de calendario que este despliegue tiene configurados. */
export function calendariosDisponibles(): ProveedorCalendario[] {
  return ORDEN.filter((p) => (process.env[ADAPTADORES[p].envAuthConfig] ?? "").trim() !== "")
}

export function calendarioConfigurado(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY?.trim()) && calendariosDisponibles().length > 0
}

export interface EstadoCalendario {
  conectado: boolean
  proveedor: ProveedorCalendario | null
  /** Si desconectarlo también le saca el correo a Athos (Microsoft: misma cuenta). */
  compartidoConElCorreo: boolean
  /**
   * No se pudo AVERIGUAR si hay conexión (Composio no respondió), que no es lo mismo que "no hay".
   *
   * La distinción no importaba mientras esto sólo pintaba una pantalla: en la duda, se muestra el
   * botón de conectar y listo. Con v5 sí importa, porque hay un calendario de RESPALDO: leer un
   * error de red como "el vet no conectó nada" haría que un corte pasajero de Composio **mude el
   * evento** al calendario del administrador —borrándolo del de la persona y volviendo a notificar
   * a todos los invitados— para devolverlo cuando el servicio vuelva. `empujarCita` lo trata como
   * fallo y no toca nada.
   */
  indeterminado?: boolean
}

/**
 * ¿Este usuario tiene calendario conectado, y con cuál?
 *
 * Se le pregunta a Composio en vez de guardar una copia: la conexión puede caerse del lado del
 * proveedor (el usuario revoca el acceso) y una tabla propia diría "conectado" para siempre.
 */
export async function estadoCalendario(userId: string): Promise<EstadoCalendario> {
  const sinConexion: EstadoCalendario = {
    conectado: false,
    proveedor: null,
    compartidoConElCorreo: false,
  }
  if (!calendarioConfigurado()) return sinConexion
  try {
    const disponibles = calendariosDisponibles()
    const items = await cuentasDe(
      userId,
      disponibles.map((p) => ADAPTADORES[p].toolkit),
    )
    const activos = new Set(items.filter((c) => c.status === "ACTIVE").map((c) => c.toolkit?.slug))
    const proveedor = disponibles.find((p) => activos.has(ADAPTADORES[p].toolkit)) ?? null
    if (!proveedor) return sinConexion
    return {
      conectado: true,
      proveedor,
      compartidoConElCorreo: ADAPTADORES[proveedor].compartidoConElCorreo,
    }
  } catch (e) {
    console.error(`[composio/calendario] no se pudo consultar la conexión de ${userId}:`, e)
    // Para la UI sigue siendo "sin conexión" —mostrar el botón de conectar es el default seguro—
    // pero queda marcado como indeterminado para que `empujarCita` no lo confunda con un "no".
    return { ...sinConexion, indeterminado: true }
  }
}

export async function iniciarConexionCalendario(
  userId: string,
  proveedor: ProveedorCalendario,
  callbackUrl: string,
): Promise<string> {
  const a = ADAPTADORES[proveedor]
  const auth = (process.env[a.envAuthConfig] ?? "").trim()
  if (!auth) throw new Error(`Falta ${a.envAuthConfig} en el servidor.`)
  // NO se desconecta nada antes de enlazar. La pantalla ya impide conectar un segundo calendario sin
  // desconectar el primero, y borrar por las dudas se volvió peligroso desde que Microsoft comparte
  // cuenta con el correo: habría dejado a alguien sin correo por tocar el botón del calendario.
  return enlazar(userId, auth, callbackUrl)
}

/**
 * Desconecta el calendario.
 *
 * Con Microsoft esto también desconecta el correo de Athos: es la misma cuenta y no hay forma de
 * soltar la mitad. La pantalla lo advierte antes (ver `compartidoConElCorreo`).
 */
export async function desconectarCalendario(userId: string): Promise<void> {
  await desconectarDe(
    userId,
    ORDEN.map((p) => ADAPTADORES[p].toolkit),
  )
}

// ─── Empujar una cita ─────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof createAdminClient>

type CitaParaSincronizar = {
  id: string
  clinic_id: string
  title: string
  reason: string | null
  notes: string | null
  starts_at: string
  ends_at: string
  owner_id: string | null
  vet_id: string | null
  /** Quién la agendó. Va invitado aunque no sea el vet asignado ni administrador. */
  created_by: string | null
  google_event_id: string | null
  microsoft_event_id: string | null
  calendar_owner_id: string | null
}

/** Los datos de la clínica que necesita el evento: quién la administra y dónde queda. */
type DatosDeLaClinica = {
  /** El administrador de respaldo: hospeda el evento si el vet asignado no conectó calendario. */
  administrador: string | null
  /** Todos los administradores. Van invitados SIEMPRE, sea quien sea el anfitrión. */
  adminIds: string[]
  direccion: string | null
}

/**
 * Quién administra la clínica y dónde queda.
 *
 * `clinics.owner_id` (migración 0048) es quien la creó, y es el anfitrión de respaldo. Se cae a
 * cualquier perfil con rol `admin` porque las clínicas creadas antes de esa migración no tienen
 * `owner_id`, y sin este respaldo sus citas no llegarían a ningún calendario sin motivo visible.
 *
 * `adminIds` es OTRA COSA y por eso se trae aparte: son todos los administradores, que van
 * invitados sin importar en el calendario de quién termine el evento. Es lo que sostiene que "el
 * admin ve el calendario completo" ahora que el evento puede vivir en la agenda de un vet.
 */
async function datosDeLaClinica(admin: AdminClient, clinicId: string): Promise<DatosDeLaClinica> {
  const [{ data: clinica }, { data: perfiles }] = await Promise.all([
    admin.from("clinics").select("owner_id, address, city").eq("id", clinicId).maybeSingle(),
    admin.from("profiles").select("id").eq("clinic_id", clinicId).eq("role", "admin"),
  ])
  const c = clinica as { owner_id: string | null; address: string | null; city: string | null } | null
  const adminIds = ((perfiles as { id: string }[] | null) ?? []).map((p) => p.id)
  return {
    // LA MISMA REGLA que usa Conexiones (`lib/calendario/quien-lo-tiene`): `owner_id` manda y el
    // primer `admin` es el respaldo. Estuvo escrita dos veces y distinto, y en una clínica anterior
    // a la 0048 eso dejaba las citas cayendo en el calendario de alguien que nunca veía el botón
    // para conectarlo. No se vuelve a duplicar.
    administrador: quienTieneElCalendario(c?.owner_id, adminIds[0] ? { id: adminIds[0] } : null),
    // El dueño puede no tener rol `admin` en clínicas viejas; se suma igual porque es quien la
    // administra de hecho, y `perfilesAInvitar` deduplica.
    adminIds: c?.owner_id ? [...new Set([c.owner_id, ...adminIds])] : adminIds,
    direccion: direccionDeLaClinica(c),
  }
}

/** El correo del titular. Puede no estar cargado: entonces no se lo invita y la cita se crea igual. */
async function correoDelTitular(admin: AdminClient, ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null
  const { data } = await admin.from("owners").select("email").eq("id", ownerId).maybeSingle()
  return (data as { email: string | null } | null)?.email ?? null
}

/**
 * Los correos de un puñado de perfiles.
 *
 * Va de a uno con `getUserById` porque el correo vive en `auth.users`, que PostgREST no expone: no
 * hay forma de pedirlos en una sola consulta sin una vista o una RPC. Son pocos —los admins de una
 * clínica, el vet asignado y quien creó la cita, ya deduplicados— y se piden en paralelo.
 */
async function correosDePerfiles(admin: AdminClient, ids: string[]): Promise<(string | null)[]> {
  return Promise.all(
    ids.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id)
      return data.user?.email ?? null
    }),
  )
}

function eventoDe(a: CitaParaSincronizar, emails: string[], direccion: string | null): EventoACrear {
  // La dirección va también en el cuerpo, además del campo de ubicación. Ver `EventoACrear.ubicacion`:
  // `location` es el único parámetro de esta capa sin verificar contra la API, y una invitación sin
  // dirección es justamente lo que hay que evitar.
  const cuerpo = [a.reason, a.notes, direccion ? `Dirección: ${direccion}` : null].filter(Boolean)
  return {
    titulo: a.title,
    descripcion: cuerpo.join("\n\n") || undefined,
    inicio: a.starts_at,
    fin: a.ends_at,
    invitados: emails,
    ...(direccion ? { ubicacion: direccion } : {}),
  }
}

/** Borra un evento del calendario de alguien. No lanza: es limpieza best-effort. */
async function limpiarEvento(
  userId: string,
  eventId: string,
  proveedor: ProveedorCalendario,
): Promise<void> {
  const { slug, args } = ADAPTADORES[proveedor].borrar(eventId)
  const r = await ejecutarTool(userId, slug, args)
  if (!r.ok) {
    console.error("[composio/calendario] no se pudo limpiar el evento anterior:", r.error)
  }
}

/**
 * Por qué una cita NO llegó a ningún calendario. `null` = sí llegó.
 *
 * Existe porque "no pasó nada" era indistinguible de "salió bien": el push es best-effort y el front
 * se lo tragaba entero. Estos motivos son ACCIONABLES —conectar el calendario de la clínica, o
 * asignarle un administrador— así que tienen que llegar a la pantalla.
 */
export type MotivoSinEvento = "sin-administrador" | "sin-calendario"

export type ResultadoEmpuje = { eventId: string | null; motivo: MotivoSinEvento | null }

/**
 * Crea o actualiza el evento en el calendario del VETERINARIO ASIGNADO —con el del administrador de
 * respaldo— invitando al titular, a todos los administradores y a quien la agendó.
 */
export async function empujarCita(appointmentId: string): Promise<ResultadoEmpuje> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("appointments")
    .select(
      "id, clinic_id, title, reason, notes, starts_at, ends_at, owner_id, vet_id, created_by, google_event_id, microsoft_event_id, calendar_owner_id",
    )
    .eq("id", appointmentId)
    .maybeSingle()
  if (!data) return { eventId: null, motivo: null }
  const a = data as CitaParaSincronizar

  const clinica = await datosDeLaClinica(admin, a.clinic_id)
  const candidatos = candidatosAAnfitrion(a.vet_id, clinica.administrador)
  if (!candidatos.length) return { eventId: null, motivo: "sin-administrador" }

  // Dónde vive hoy el evento, si vive en algún lado. El proveedor sale de QUÉ COLUMNA tiene el id,
  // no de la conexión actual: la conexión pudo cambiar desde que se creó.
  const previo: { id: string; proveedor: ProveedorCalendario } | null = a.google_event_id
    ? { id: a.google_event_id, proveedor: "google" }
    : a.microsoft_event_id
      ? { id: a.microsoft_event_id, proveedor: "outlook" }
      : null

  // EL PRIMER CANDIDATO QUE TENGA CALENDARIO CONECTADO se queda con el evento. Se pregunta de a uno
  // y se corta al primero: son dos consultas a Composio en el peor caso, y la segunda sólo ocurre
  // cuando el vet asignado no conectó nada.
  let anfitrion: string | null = null
  let proveedor: ProveedorCalendario | null = null
  for (const candidato of candidatos) {
    const estado = await estadoCalendario(candidato)
    // NO SABER si hay conexión no es lo mismo que no tenerla, y acá la diferencia se paga cara: si
    // Composio no contesta y esto lo leyera como "el vet no conectó nada", el evento se MUDARÍA al
    // calendario del administrador —borrándose del de la persona y volviendo a notificar a todos—
    // para regresar cuando el servicio vuelva. Se corta antes de tocar nada; la cita ya está
    // guardada en Tuvetia y quien llama muestra el error.
    if (estado.indeterminado) {
      throw new Error(
        "No se pudo consultar el calendario ahora mismo. La cita quedó guardada; volvé a guardarla en un momento para copiarla al calendario.",
      )
    }
    if (estado.proveedor) {
      anfitrion = candidato
      proveedor = estado.proveedor
      break
    }
  }

  // Hay que sacar el evento de donde está si cambió el anfitrión —porque se reasignó la cita a otro
  // veterinario, o porque el vet conectó su calendario y la cita deja de vivir en el del admin— o si
  // cambió el proveedor. Si no, queda un fantasma en una agenda que ya no tiene que ver con la cita.
  const mudanza = Boolean(
    previo &&
      a.calendar_owner_id &&
      (a.calendar_owner_id !== anfitrion || previo.proveedor !== proveedor),
  )
  if (mudanza && previo) {
    await limpiarEvento(a.calendar_owner_id as string, previo.id, previo.proveedor)
  }

  if (!anfitrion || !proveedor) {
    // Ni el vet asignado ni el administrador conectaron calendario. Si veníamos de otro, allá ya se
    // limpió: se olvidan los ids para no dejar la fila apuntando a un evento que ya no existe.
    if (mudanza) {
      await admin
        .from("appointments")
        .update({ google_event_id: null, microsoft_event_id: null, calendar_owner_id: null })
        .eq("id", a.id)
    }
    return { eventId: null, motivo: "sin-calendario" }
  }

  const adaptador = ADAPTADORES[proveedor]
  const aInvitar = perfilesAInvitar({
    anfitrionId: anfitrion,
    adminIds: clinica.adminIds,
    vetId: a.vet_id,
    creadorId: a.created_by,
  })
  const evento = eventoDe(
    a,
    correosDeInvitados(
      await correosDePerfiles(admin, aInvitar),
      await correoDelTitular(admin, a.owner_id),
    ),
    clinica.direccion,
  )
  // Tras una mudanza el evento se CREA: el id viejo era de la otra agenda o del otro proveedor.
  const idVigente = mudanza || previo?.proveedor !== proveedor ? null : previo.id
  const { slug, args } = idVigente
    ? adaptador.actualizar(idVigente, evento)
    : adaptador.crear(evento)

  const r = await ejecutarTool(anfitrion, slug, args)
  if (!r.ok) throw new Error(r.error)

  // Al crear, un id ilegible es un FALLO, no un detalle: sin él la fila queda sin referencia al
  // evento y la próxima edición crearía un duplicado en vez de actualizarlo. Al actualizar no
  // importa — el id que ya teníamos sigue siendo válido.
  const nuevoId = adaptador.idDelEvento(r.data) ?? idVigente
  if (!nuevoId) {
    throw new Error(
      "El calendario creó el evento pero no devolvió su identificador, así que la cita queda sin vincular. Volvé a guardar la cita.",
    )
  }

  // Sólo la columna del proveedor en uso queda con id; la otra se limpia, para que nunca haya dos
  // ids vivos apuntando a eventos en calendarios distintos.
  await admin
    .from("appointments")
    .update({
      google_event_id: proveedor === "google" ? nuevoId : null,
      microsoft_event_id: proveedor === "outlook" ? nuevoId : null,
      calendar_owner_id: anfitrion,
    })
    .eq("id", a.id)

  return { eventId: nuevoId, motivo: null }
}

/** Borra el evento remoto del calendario de quien lo tenía. */
export async function borrarEventoRemoto(
  calendarOwnerId: string,
  eventId: string,
  proveedor: ProveedorCalendario,
): Promise<void> {
  const { slug, args } = ADAPTADORES[proveedor].borrar(eventId)
  const r = await ejecutarTool(calendarOwnerId, slug, args)
  // Un evento que ya no está es el resultado buscado, no un error: borrar tiene que ser idempotente
  // porque esto se reintenta y porque el evento pudo haberse borrado a mano.
  if (!r.ok && !/not found|410|404|deleted|no existe/i.test(r.error)) {
    throw new Error(r.error)
  }
}

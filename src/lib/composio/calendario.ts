import "server-only"

// Calendario vía Composio — el calendario que conecta CADA VETERINARIO.
//
// Reemplaza al OAuth propio (`google-calendar.ts`), que guardaba un refresh token por usuario en
// `calendar_integrations` y lo refrescaba a mano contra Google. Ese camino funcionaba pero traía
// todo lo que Composio ya resuelve: credenciales del servidor que mantener, tokens nuestros en la
// base, y el refresh fallando con `invalid_grant` cada vez que Google revocaba algo.
//
// LAS DOS REGLAS DEL CALENDARIO (v3, migración 0049) NO CAMBIAN, y son lo que hay que preservar al
// leer este archivo:
//
//   1. UNA SOLA VÍA. Tuvetia EMPUJA sus citas; no lee nada de vuelta. El `pullEvents` que existió
//      trajo el calendario personal de un vet (11.695 "Comer"/"Trabajo"/"Dormir") a la agenda de la
//      clínica. Sin lectura ese problema no puede repetirse: no es un filtro mejor, es que el canal
//      no existe. Por eso acá sólo hay crear, actualizar y borrar.
//   2. EL EVENTO VIVE EN EL CALENDARIO DEL ADMINISTRADOR DE LA CLÍNICA, y el veterinario asignado
//      va INVITADO, igual que el titular — como cuando a uno le llega una invitación a una reunión.
//
//      Esto reemplaza a "el evento es del veterinario asignado", que se veía razonable y en la
//      práctica no lo era: el evento aparecía en el calendario del vet asignado y el administrador
//      —que es quien agenda y quien mira la agenda de la clínica— no lo veía en ningún lado. Se
//      reportó como "no crea ni mierda" cuando en realidad sí creaba, en un calendario que la
//      persona que agendó no tenía a la vista.
//
//      Un solo calendario por clínica también resuelve el caso del vet que nunca conectó el suyo:
//      antes eso significaba que la cita no llegaba a ningún calendario. Ahora igual queda en el
//      del administrador y al vet le llega la invitación a su correo.
//
// Por ahora sólo Google. Outlook Calendar entra agregando un adaptador y su auth config, sin tocar
// nada de lo de abajo.

import { createAdminClient } from "@/lib/supabase/admin"

import { cuentasDe, desconectarDe, ejecutarTool, enlazar } from "./cliente"

export type ProveedorCalendario = "google"

export const NOMBRE_CALENDARIO: Record<ProveedorCalendario, string> = {
  google: "Google Calendar",
}

/** Un evento tal como lo entiende Tuvetia, antes de traducirlo a la tool de cada proveedor. */
export interface EventoACrear {
  titulo: string
  descripcion?: string
  /** ISO con zona (lo que guarda Postgres en un timestamptz). */
  inicio: string
  fin: string
  invitados: string[]
}

interface AdaptadorCalendario {
  toolkit: string
  envAuthConfig: string
  crear(e: EventoACrear): { slug: string; args: Record<string, unknown> }
  actualizar(eventId: string, e: EventoACrear): { slug: string; args: Record<string, unknown> }
  borrar(eventId: string): { slug: string; args: Record<string, unknown> }
  /** El id del evento creado, sacado de la respuesta. Null si no se pudo leer. */
  idDelEvento(data: unknown): string | null
}

/**
 * Fecha en el formato que pide la tool: `YYYY-MM-DDTHH:MM:SS`, sin zona.
 *
 * Se manda en UTC y con `timezone: "UTC"` aparte. La tool acepta una fecha "naive" más una zona
 * IANA, así que mandar el instante en UTC es lo único que no depende de dónde corra el servidor ni
 * de si Colombia cambió de offset.
 */
function fechaParaGoogle(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19)
}

function argsDeGoogle(e: EventoACrear): Record<string, unknown> {
  return {
    calendar_id: "primary",
    summary: e.titulo,
    ...(e.descripcion ? { description: e.descripcion } : {}),
    start_datetime: fechaParaGoogle(e.inicio),
    end_datetime: fechaParaGoogle(e.fin),
    timezone: "UTC",
    ...(e.invitados.length ? { attendees: e.invitados } : {}),
    // Que al titular le llegue la invitación es el punto de empujar la cita: sin esto el evento
    // aparece en el calendario del vet y el cliente no se entera de nada.
    send_updates: "all",
  }
}

const GOOGLE: AdaptadorCalendario = {
  toolkit: "googlecalendar",
  envAuthConfig: "COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID",

  crear: (e) => ({ slug: "GOOGLECALENDAR_CREATE_EVENT", args: argsDeGoogle(e) }),
  actualizar: (eventId, e) => ({
    slug: "GOOGLECALENDAR_UPDATE_EVENT",
    args: { ...argsDeGoogle(e), event_id: eventId },
  }),
  borrar: (eventId) => ({
    slug: "GOOGLECALENDAR_DELETE_EVENT",
    args: { calendar_id: "primary", event_id: eventId },
  }),

  idDelEvento: (data) => {
    const raiz = (data as { response_data?: unknown })?.response_data ?? data
    const d = (raiz ?? {}) as Record<string, unknown>
    for (const v of [d.id, (d.event as Record<string, unknown> | undefined)?.id, d.event_id]) {
      if (typeof v === "string" && v) return v
    }
    return null
  },
}

const ADAPTADORES: Record<ProveedorCalendario, AdaptadorCalendario> = { google: GOOGLE }

/** Para los tests: la traducción a la tool es lo único de acá que se puede probar sin red. */
export function adaptadorCalendario(p: ProveedorCalendario): AdaptadorCalendario {
  return ADAPTADORES[p]
}

/** Los proveedores de calendario que este despliegue tiene configurados. */
export function calendariosDisponibles(): ProveedorCalendario[] {
  return (Object.keys(ADAPTADORES) as ProveedorCalendario[]).filter(
    (p) => (process.env[ADAPTADORES[p].envAuthConfig] ?? "").trim() !== "",
  )
}

export function calendarioConfigurado(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY?.trim()) && calendariosDisponibles().length > 0
}

/**
 * ¿Este veterinario conectó su calendario?
 *
 * Se le pregunta a Composio en vez de guardar una copia: la conexión puede caerse del lado del
 * proveedor (el vet revoca el acceso) y una tabla propia diría "conectado" para siempre.
 */
export async function estadoCalendario(
  userId: string,
): Promise<{ conectado: boolean; proveedor: ProveedorCalendario | null }> {
  if (!calendarioConfigurado()) return { conectado: false, proveedor: null }
  try {
    const items = await cuentasDe(
      userId,
      calendariosDisponibles().map((p) => ADAPTADORES[p].toolkit),
    )
    const activa = items.find((c) => c.status === "ACTIVE")
    if (!activa) return { conectado: false, proveedor: null }
    const proveedor =
      calendariosDisponibles().find((p) => ADAPTADORES[p].toolkit === activa.toolkit?.slug) ?? null
    return { conectado: true, proveedor }
  } catch (e) {
    console.error(`[composio/calendario] no se pudo consultar la conexión de ${userId}:`, e)
    return { conectado: false, proveedor: null }
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
  // Uno solo por persona: con dos conectados, las citas irían a uno u otro sin que nadie lo decida.
  await desconectarCalendario(userId).catch((e) => {
    console.error(`[composio/calendario] no se pudo limpiar la conexión previa de ${userId}:`, e)
  })
  return enlazar(userId, auth, callbackUrl)
}

export async function desconectarCalendario(userId: string): Promise<void> {
  await desconectarDe(
    userId,
    (Object.keys(ADAPTADORES) as ProveedorCalendario[]).map((p) => ADAPTADORES[p].toolkit),
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
  google_event_id: string | null
  calendar_owner_id: string | null
}

/**
 * De quién es el calendario de una clínica: su administrador.
 *
 * `clinics.owner_id` (migración 0048) es quien creó la clínica. Se cae a cualquier perfil con rol
 * `admin` porque las clínicas creadas antes de esa migración no tienen `owner_id`, y sin este
 * respaldo sus citas no llegarían a ningún calendario sin ningún motivo visible.
 */
async function calendarioDeLaClinica(
  admin: AdminClient,
  clinicId: string,
): Promise<string | null> {
  const { data: clinica } = await admin
    .from("clinics")
    .select("owner_id")
    .eq("id", clinicId)
    .maybeSingle()
  const owner = (clinica as { owner_id: string | null } | null)?.owner_id
  if (owner) return owner

  const { data: perfil } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle()
  return (perfil as { id: string } | null)?.id ?? null
}

/**
 * Correos del titular y del veterinario asignado, para invitarlos.
 *
 * Cualquiera de los dos puede faltar (un titular sin correo cargado): se omite en vez de hacer
 * fallar el push, porque la cita en la agenda del vet vale aunque nadie más reciba la invitación.
 */
async function invitados(
  admin: AdminClient,
  ownerId: string | null,
  vetId: string | null,
): Promise<string[]> {
  const emails: string[] = []
  if (ownerId) {
    const { data } = await admin.from("owners").select("email").eq("id", ownerId).maybeSingle()
    const email = (data as { email: string | null } | null)?.email
    if (email) emails.push(email)
  }
  if (vetId) {
    const { data } = await admin.auth.admin.getUserById(vetId)
    if (data.user?.email) emails.push(data.user.email)
  }
  return emails
}

function eventoDe(a: CitaParaSincronizar, emails: string[]): EventoACrear {
  return {
    titulo: a.title,
    descripcion: [a.reason, a.notes].filter(Boolean).join("\n\n") || undefined,
    inicio: a.starts_at,
    fin: a.ends_at,
    invitados: emails,
  }
}

/** Borra el evento del calendario de otro veterinario. No lanza: es limpieza best-effort. */
async function limpiarEventoDe(userId: string, eventId: string): Promise<void> {
  const { proveedor } = await estadoCalendario(userId)
  if (!proveedor) return
  const { slug, args } = ADAPTADORES[proveedor].borrar(eventId)
  const r = await ejecutarTool(userId, slug, args)
  if (!r.ok) {
    console.error("[composio/calendario] no se pudo limpiar el evento del vet anterior:", r.error)
  }
}

/**
 * Por qué una cita NO llegó a ningún calendario. `null` = sí llegó.
 *
 * Existe porque "no pasó nada" era indistinguible de "salió bien": el push es best-effort y el
 * front se lo tragaba entero. Estos motivos son ACCIONABLES —conectar el calendario de la clínica,
 * o asignarle un administrador— así que tienen que llegar a la pantalla.
 */
export type MotivoSinEvento = "sin-administrador" | "sin-calendario"

export type ResultadoEmpuje = { eventId: string | null; motivo: MotivoSinEvento | null }

/**
 * Crea o actualiza el evento en el calendario del ADMINISTRADOR de la clínica, invitando al titular
 * y al veterinario asignado.
 */
export async function empujarCita(appointmentId: string): Promise<ResultadoEmpuje> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("appointments")
    .select(
      "id, clinic_id, title, reason, notes, starts_at, ends_at, owner_id, vet_id, google_event_id, calendar_owner_id",
    )
    .eq("id", appointmentId)
    .maybeSingle()
  if (!data) return { eventId: null, motivo: null }
  const a = data as CitaParaSincronizar

  const adminDeLaClinica = await calendarioDeLaClinica(admin, a.clinic_id)
  if (!adminDeLaClinica) return { eventId: null, motivo: "sin-administrador" }

  // Cambió el administrador (o la cita venía del modelo anterior, con el evento en el calendario de
  // un veterinario): el evento viejo vive en OTRO calendario y hay que sacarlo de ahí, o queda de
  // fantasma en la agenda de alguien que ya no tiene nada que ver con esta cita.
  const cambioDeCalendario = Boolean(
    a.google_event_id && a.calendar_owner_id && a.calendar_owner_id !== adminDeLaClinica,
  )
  if (cambioDeCalendario) {
    await limpiarEventoDe(a.calendar_owner_id as string, a.google_event_id as string)
  }

  const { proveedor } = await estadoCalendario(adminDeLaClinica)
  if (!proveedor) {
    // El administrador no conectó calendario. Si veníamos de otro, allá ya se limpió: se olvida el
    // id para no dejar la fila apuntando a un evento que ya no existe.
    if (cambioDeCalendario) {
      await admin
        .from("appointments")
        .update({ google_event_id: null, calendar_owner_id: null })
        .eq("id", a.id)
    }
    return { eventId: null, motivo: "sin-calendario" }
  }

  const evento = eventoDe(a, await invitados(admin, a.owner_id, a.vet_id))
  // Tras un cambio de calendario el evento se CREA: el id viejo era de la agenda del otro.
  const idVigente = cambioDeCalendario ? null : a.google_event_id
  const adaptador = ADAPTADORES[proveedor]
  const { slug, args } = idVigente
    ? adaptador.actualizar(idVigente, evento)
    : adaptador.crear(evento)

  const r = await ejecutarTool(adminDeLaClinica, slug, args)
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

  if (nuevoId !== a.google_event_id || a.calendar_owner_id !== adminDeLaClinica) {
    await admin
      .from("appointments")
      .update({ google_event_id: nuevoId, calendar_owner_id: adminDeLaClinica })
      .eq("id", a.id)
  }
  return { eventId: nuevoId, motivo: null }
}

/** Borra el evento remoto del calendario de quien lo tenía. */
export async function borrarEventoRemoto(
  calendarOwnerId: string,
  eventId: string,
): Promise<void> {
  const { proveedor } = await estadoCalendario(calendarOwnerId)
  if (!proveedor) return
  const { slug, args } = ADAPTADORES[proveedor].borrar(eventId)
  const r = await ejecutarTool(calendarOwnerId, slug, args)
  // Un evento que ya no está es el resultado buscado, no un error: borrar tiene que ser idempotente
  // porque esto se reintenta y porque el vet pudo haberlo borrado a mano.
  if (!r.ok && !/not found|410|deleted|no existe/i.test(r.error)) {
    throw new Error(r.error)
  }
}

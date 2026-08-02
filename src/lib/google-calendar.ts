// Sincronización con Google Calendar (v3) — SOLO servidor. REST directo (sin dependencias), con el
// cliente service_role para leer el refresh_token del vet y escribir google_event_id.
//
// v3 (migración 0049) — dos reglas que resumen todo el archivo:
//
//   1. UNA SOLA VÍA. Tuvetia EMPUJA sus citas al calendario; no lee nada de vuelta. El `pullEvents`
//      que había acá trajo el calendario personal de un vet (11.695 "Comer"/"Trabajo"/"Dormir") a la
//      agenda de la clínica. Sin lectura, ese problema no puede repetirse — no es un filtro mejor,
//      es que el canal ya no existe.
//   2. EL EVENTO ES DEL VETERINARIO ASIGNADO. Se busca la integración de `appointments.vet_id`, no
//      la de quien apretó el botón ni la de un calendario compartido de clínica. La agenda de
//      trabajo es de cada vet.
//
// La conexión es explícita desde Conexiones (ya no se guarda ningún token en el login).
//
// Config externa requerida: en el entorno del servidor GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y
// SUPABASE_SERVICE_ROLE_KEY.

import { createAdminClient } from "@/lib/supabase/admin"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const CAL_API = "https://www.googleapis.com/calendar/v3/calendars"

type Integration = {
  refresh_token: string | null
  google_calendar_id: string
}

type AppointmentForSync = {
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

// Guarda el refresh token de Google del usuario. Lo llama SOLO el route /connect, con el usuario
// que apretó "Conectar" en Conexiones — ya no hay vinculación automática en el login.
export async function upsertGoogleIntegration(
  userId: string,
  clinicId: string,
  refreshToken: string,
  googleCalendarId = "primary",
): Promise<void> {
  const admin = createAdminClient()
  await admin.from("calendar_integrations").upsert(
    {
      clinic_id: clinicId,
      user_id: userId,
      provider: "google",
      google_calendar_id: googleCalendarId,
      refresh_token: refreshToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  )
}

/** Desconectar: borra la integración del usuario. Las citas ya empujadas quedan en su calendario. */
export async function deleteGoogleIntegration(userId: string): Promise<void> {
  const admin = createAdminClient()
  await admin.from("calendar_integrations").delete().eq("user_id", userId).eq("provider", "google")
}

function googleCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID
  const secret = process.env.GOOGLE_CLIENT_SECRET
  if (!id || !secret) {
    throw new Error("Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en el servidor")
  }
  return { id, secret }
}

/**
 * Traduce el error del endpoint de token de Google a algo accionable.
 *
 * Google contesta 400 con el motivo REAL en el cuerpo (`error`/`error_description`), y antes se
 * descartaba: el vet veía "falló (400)" y no había forma de saber si el token estaba revocado, si
 * las credenciales del servidor no eran las que emitieron ese token, o qué.
 */
function explicarErrorDeToken(status: number, error: string, description: string): string {
  if (error === "invalid_grant") {
    return "Google rechazó el token guardado (invalid_grant): fue revocado o venció. Reconectá Google Calendar desde Conexiones. Si se repite cada semana, la app sigue en modo Testing en Google Cloud — hay que publicarla."
  }
  if (error === "invalid_client" || error === "unauthorized_client") {
    return "Las credenciales del servidor no son las que emitieron el token (invalid_client). GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET tienen que ser el MISMO cliente OAuth configurado en Supabase Auth → Google."
  }
  const detalle = description || error || `HTTP ${status}`
  return `Google rechazó el refresh del token: ${detalle}`
}

// Refresca un access token a partir del refresh token del vet.
async function accessTokenFrom(refreshToken: string): Promise<string> {
  const { id, secret } = googleCreds()
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => ({}))) as {
      error?: string
      error_description?: string
    }
    const msg = explicarErrorDeToken(res.status, cuerpo.error ?? "", cuerpo.error_description ?? "")
    console.error(`[google-calendar] refresh falló (${res.status}):`, cuerpo)
    throw new Error(msg)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error("Google no devolvió access_token")
  return json.access_token
}

function eventBody(a: AppointmentForSync, attendeeEmails: string[]) {
  const description = [a.reason, a.notes].filter(Boolean).join("\n\n") || undefined
  return {
    summary: a.title,
    description,
    start: { dateTime: new Date(a.starts_at).toISOString() },
    end: { dateTime: new Date(a.ends_at).toISOString() },
    ...(attendeeEmails.length ? { attendees: attendeeEmails.map((email) => ({ email })) } : {}),
  }
}

type AdminClient = ReturnType<typeof createAdminClient>

async function getIntegration(admin: AdminClient, userId: string): Promise<Integration | null> {
  const { data } = await admin
    .from("calendar_integrations")
    .select("refresh_token, google_calendar_id")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle()
  return (data as Integration | null) ?? null
}

// Emails del titular y del vet asignado, para invitarlos como attendees. Cualquiera de los dos puede
// faltar (titular sin email) — se omiten en vez de fallar el push.
async function attendeeEmailsFor(
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

/** Borra el evento del calendario de `ownerUserId`. No lanza: es limpieza best-effort. */
async function borrarEventoDe(
  admin: AdminClient,
  ownerUserId: string,
  eventId: string,
): Promise<void> {
  try {
    const integ = await getIntegration(admin, ownerUserId)
    if (!integ?.refresh_token) return
    const access = await accessTokenFrom(integ.refresh_token)
    const calId = encodeURIComponent(integ.google_calendar_id)
    await fetch(`${CAL_API}/${calId}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${access}` },
    })
  } catch (e) {
    console.error("[google-calendar] no se pudo limpiar el evento del vet anterior:", e)
  }
}

/**
 * Push: crea o actualiza el evento en el calendario del VETERINARIO ASIGNADO, con el titular y el
 * propio vet como invitados. Devuelve el google_event_id, o null si ese vet no conectó Google.
 *
 * Si la cita cambió de veterinario, el evento se borra del calendario del anterior antes de crearse
 * en el del nuevo: sin eso queda un fantasma en la agenda de alguien que ya no atiende esa cita.
 */
export async function pushAppointment(appointmentId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data: appt } = await admin
    .from("appointments")
    .select(
      "id, clinic_id, title, reason, notes, starts_at, ends_at, owner_id, vet_id, google_event_id, calendar_owner_id",
    )
    .eq("id", appointmentId)
    .maybeSingle()
  if (!appt) return null
  const a = appt as AppointmentForSync
  if (!a.vet_id) return null // sin veterinario no hay calendario destino

  // Cambió el vet asignado: el evento viejo vive en OTRO calendario y hay que sacarlo de ahí.
  const cambioDeCalendario = Boolean(
    a.google_event_id && a.calendar_owner_id && a.calendar_owner_id !== a.vet_id,
  )
  if (cambioDeCalendario) {
    await borrarEventoDe(admin, a.calendar_owner_id as string, a.google_event_id as string)
  }

  const integ = await getIntegration(admin, a.vet_id)
  if (!integ?.refresh_token) {
    // El vet no conectó Google. Si además veníamos de otro calendario, ya se limpió allá: se
    // olvida el id para no dejar apuntando a un evento que ya no existe.
    if (cambioDeCalendario) {
      await admin
        .from("appointments")
        .update({ google_event_id: null, calendar_owner_id: null })
        .eq("id", a.id)
    }
    return null
  }

  const access = await accessTokenFrom(integ.refresh_token)
  const calId = encodeURIComponent(integ.google_calendar_id)
  const attendeeEmails = await attendeeEmailsFor(admin, a.owner_id, a.vet_id)
  // Tras un cambio de calendario el evento se CREA (el id viejo era de la agenda del otro vet).
  const eventIdVigente = cambioDeCalendario ? null : a.google_event_id
  const isUpdate = Boolean(eventIdVigente)
  const url = isUpdate
    ? `${CAL_API}/${calId}/events/${encodeURIComponent(eventIdVigente as string)}?sendUpdates=all`
    : `${CAL_API}/${calId}/events?sendUpdates=all`
  const res = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(a, attendeeEmails)),
  })
  if (!res.ok) throw new Error(`Google Calendar ${isUpdate ? "patch" : "insert"} falló (${res.status})`)
  const ev = (await res.json()) as { id?: string }
  const nuevoId = ev.id ?? eventIdVigente
  if (nuevoId !== a.google_event_id || a.calendar_owner_id !== a.vet_id) {
    await admin
      .from("appointments")
      .update({ google_event_id: nuevoId, calendar_owner_id: a.vet_id })
      .eq("id", a.id)
  }
  return nuevoId
}

/**
 * Borra el evento remoto al eliminar la cita, del calendario de quien lo tenía
 * (`appointments.calendar_owner_id`, capturado antes de borrar la fila).
 */
export async function deleteRemoteEvent(
  calendarOwnerId: string,
  googleEventId: string,
): Promise<void> {
  const admin = createAdminClient()
  const integ = await getIntegration(admin, calendarOwnerId)
  if (!integ?.refresh_token) return
  const access = await accessTokenFrom(integ.refresh_token)
  const calId = encodeURIComponent(integ.google_calendar_id)
  const res = await fetch(
    `${CAL_API}/${calId}/events/${encodeURIComponent(googleEventId)}?sendUpdates=all`,
    { method: "DELETE", headers: { Authorization: `Bearer ${access}` } },
  )
  // 410 = ya borrado; lo tratamos como éxito idempotente.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new Error(`Google Calendar delete falló (${res.status})`)
  }
}

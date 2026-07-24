// Sincronización con Google Calendar (v1b/v1c) — SOLO servidor. REST directo (sin dependencias),
// con el cliente service_role para leer el refresh_token del vet y escribir google_event_id.
//
// Config externa requerida (documentada en DEPLOY del calendario): en el entorno del servidor
// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y SUPABASE_SERVICE_ROLE_KEY; y el proveedor Google de
// Supabase configurado para devolver refresh token con el scope calendar.events.

import { createAdminClient } from "@/lib/supabase/admin"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const CAL_API = "https://www.googleapis.com/calendar/v3/calendars"

type Integration = {
  refresh_token: string | null
  google_calendar_id: string
  sync_token: string | null
}

type AppointmentForSync = {
  id: string
  clinic_id: string
  title: string
  reason: string | null
  notes: string | null
  starts_at: string
  ends_at: string
  google_event_id: string | null
}

// Guarda el refresh token de Google del usuario (lo llama el /auth/callback cuando el login trae uno,
// o el route /connect en el reconnect explícito). Idempotente por (user_id, provider). Sin clínica, no-op.
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

function googleCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID
  const secret = process.env.GOOGLE_CLIENT_SECRET
  if (!id || !secret) {
    throw new Error("Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en el servidor")
  }
  return { id, secret }
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
  if (!res.ok) throw new Error(`Google token refresh falló (${res.status})`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error("Google no devolvió access_token")
  return json.access_token
}

function eventBody(a: AppointmentForSync) {
  const description = [a.reason, a.notes].filter(Boolean).join("\n\n") || undefined
  return {
    summary: a.title,
    description,
    start: { dateTime: new Date(a.starts_at).toISOString() },
    end: { dateTime: new Date(a.ends_at).toISOString() },
  }
}

type AdminClient = ReturnType<typeof createAdminClient>

async function getIntegration(admin: AdminClient, userId: string): Promise<Integration | null> {
  const { data } = await admin
    .from("calendar_integrations")
    .select("refresh_token, google_calendar_id, sync_token")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle()
  return (data as Integration | null) ?? null
}

// Push: crea o actualiza el evento de Google para una cita, y guarda google_event_id.
// No-op si el usuario no conectó Google. Devuelve el google_event_id (o null si no conectado).
export async function pushAppointment(userId: string, appointmentId: string): Promise<string | null> {
  const admin = createAdminClient()
  const integ = await getIntegration(admin, userId)
  if (!integ?.refresh_token) return null // no conectado -> el calendario interno sigue funcionando

  const { data: appt } = await admin
    .from("appointments")
    .select("id, clinic_id, title, reason, notes, starts_at, ends_at, google_event_id")
    .eq("id", appointmentId)
    .maybeSingle()
  if (!appt) return null
  const a = appt as AppointmentForSync

  const access = await accessTokenFrom(integ.refresh_token)
  const calId = encodeURIComponent(integ.google_calendar_id)
  const isUpdate = Boolean(a.google_event_id)
  const url = isUpdate
    ? `${CAL_API}/${calId}/events/${encodeURIComponent(a.google_event_id as string)}`
    : `${CAL_API}/${calId}/events`
  const res = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(a)),
  })
  if (!res.ok) throw new Error(`Google Calendar ${isUpdate ? "patch" : "insert"} falló (${res.status})`)
  const ev = (await res.json()) as { id?: string }
  if (ev.id && ev.id !== a.google_event_id) {
    await admin.from("appointments").update({ google_event_id: ev.id }).eq("id", a.id)
  }
  return ev.id ?? a.google_event_id
}

// Borra el evento remoto (al eliminar la cita).
export async function deleteRemoteEvent(userId: string, googleEventId: string): Promise<void> {
  const admin = createAdminClient()
  const integ = await getIntegration(admin, userId)
  if (!integ?.refresh_token) return
  const access = await accessTokenFrom(integ.refresh_token)
  const calId = encodeURIComponent(integ.google_calendar_id)
  const res = await fetch(`${CAL_API}/${calId}/events/${encodeURIComponent(googleEventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${access}` },
  })
  // 410 = ya borrado; lo tratamos como éxito idempotente.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new Error(`Google Calendar delete falló (${res.status})`)
  }
}

type GoogleEvent = {
  id: string
  status?: string
  summary?: string
  description?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

// Pull incremental: trae los cambios de Google desde el último syncToken y los upsertea por
// google_event_id. Eventos cancelados en Google -> se cancelan localmente. Devuelve nº de cambios.
export async function pullEvents(userId: string): Promise<number> {
  const admin = createAdminClient()
  const integ = await getIntegration(admin, userId)
  if (!integ?.refresh_token) return 0

  const { data: prof } = await admin
    .from("profiles")
    .select("clinic_id")
    .eq("id", userId)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return 0

  const access = await accessTokenFrom(integ.refresh_token)
  const calId = encodeURIComponent(integ.google_calendar_id)

  let changed = 0
  let pageToken: string | undefined
  let nextSyncToken: string | undefined
  const syncToken = integ.sync_token ?? undefined

  for (;;) {
    const params = new URLSearchParams()
    if (syncToken) params.set("syncToken", syncToken)
    else params.set("timeMin", new Date(Date.now() - 30 * 864e5).toISOString()) // primer sync: 30 días atrás
    if (pageToken) params.set("pageToken", pageToken)
    params.set("showDeleted", "true")
    params.set("singleEvents", "true")

    const res = await fetch(`${CAL_API}/${calId}/events?${params.toString()}`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    if (res.status === 410) {
      // syncToken vencido -> reiniciar sync completo la próxima vez.
      await admin.from("calendar_integrations").update({ sync_token: null }).eq("user_id", userId)
      return changed
    }
    if (!res.ok) throw new Error(`Google Calendar list falló (${res.status})`)
    const json = (await res.json()) as {
      items?: GoogleEvent[]
      nextPageToken?: string
      nextSyncToken?: string
    }

    for (const ev of json.items ?? []) {
      changed += await applyRemoteEvent(admin, clinicId, ev)
    }

    if (json.nextPageToken) {
      pageToken = json.nextPageToken
      continue
    }
    nextSyncToken = json.nextSyncToken
    break
  }

  if (nextSyncToken) {
    await admin.from("calendar_integrations").update({ sync_token: nextSyncToken }).eq("user_id", userId)
  }
  return changed
}

// Aplica un evento remoto a la BD local. Devuelve 1 si cambió algo.
async function applyRemoteEvent(admin: AdminClient, clinicId: string, ev: GoogleEvent): Promise<number> {
  const { data: existing } = await admin
    .from("appointments")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("google_event_id", ev.id)
    .maybeSingle()
  const localId = (existing as { id: string } | null)?.id ?? null

  if (ev.status === "cancelled") {
    if (localId) {
      await admin.from("appointments").update({ status: "canceled" }).eq("id", localId)
      return 1
    }
    return 0
  }

  const start = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null)
  const end = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null)
  if (!start || !end) return 0

  if (localId) {
    await admin
      .from("appointments")
      .update({
        title: ev.summary ?? "(sin título)",
        notes: ev.description ?? null,
        starts_at: start,
        ends_at: end,
        updated_at: new Date().toISOString(),
      })
      .eq("id", localId)
    return 1
  }

  // Evento nuevo creado en Google: alta mínima (sin paciente/titular) enlazada por google_event_id.
  await admin.from("appointments").insert({
    clinic_id: clinicId,
    title: ev.summary ?? "(sin título)",
    notes: ev.description ?? null,
    starts_at: start,
    ends_at: end,
    status: "scheduled",
    google_event_id: ev.id,
  })
  return 1
}

// Sincronización con Google Calendar (v1b/v1c/v2) — SOLO servidor. REST directo (sin dependencias),
// con el cliente service_role para leer el refresh_token del admin y escribir google_event_id.
//
// v2 (0048_calendar_admin_redesign): UNA sola cuenta por clínica — la del administrador que la creó
// (clinics.owner_id) — en vez de una por vet. Push/pull/delete resuelven esa cuenta a partir de la
// clínica, no de la sesión de quien los dispara. El titular y el veterinario asignado entran como
// `attendees` del evento: la invitación (y su recordatorio) les llega por correo directo de Google,
// sin que cada vet tenga que conectar su propia cuenta.
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
  owner_id: string | null
  vet_id: string | null
  google_event_id: string | null
}

// Guarda el refresh token de Google del ADMIN de la clínica (lo llama el /auth/callback cuando su
// login trae uno, o el route /connect en el reconnect explícito — ambos ya validan que quien conecta
// sea clinics.owner_id antes de llegar acá). Idempotente por (user_id, provider).
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

// Refresca un access token a partir del refresh token del admin.
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

// El admin de una clínica para efectos de calendario: clinics.owner_id (fijado al crear la clínica,
// ver 0048_calendar_admin_redesign.sql). Si una clínica no tiene owner_id (caso raro, sin miembros
// todavía) no hay a quién sincronizar.
async function resolveClinicAdmin(admin: AdminClient, clinicId: string): Promise<string | null> {
  const { data } = await admin.from("clinics").select("owner_id").eq("id", clinicId).maybeSingle()
  return (data as { owner_id: string | null } | null)?.owner_id ?? null
}

async function getIntegration(admin: AdminClient, userId: string): Promise<Integration | null> {
  const { data } = await admin
    .from("calendar_integrations")
    .select("refresh_token, google_calendar_id, sync_token")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle()
  return (data as Integration | null) ?? null
}

// Emails del titular y del vet asignado, para invitarlos como attendees. Cualquiera de los dos puede
// faltar (titular sin email, cita sin vet todavía) — se omiten en vez de fallar el push.
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

// Push: crea o actualiza el evento en el Google Calendar del ADMIN de la clínica de la cita, y
// guarda google_event_id. No-op si el admin no conectó Google. Devuelve el google_event_id (o null).
export async function pushAppointment(appointmentId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data: appt } = await admin
    .from("appointments")
    .select("id, clinic_id, title, reason, notes, starts_at, ends_at, owner_id, vet_id, google_event_id")
    .eq("id", appointmentId)
    .maybeSingle()
  if (!appt) return null
  const a = appt as AppointmentForSync

  const adminUserId = await resolveClinicAdmin(admin, a.clinic_id)
  if (!adminUserId) return null
  const integ = await getIntegration(admin, adminUserId)
  if (!integ?.refresh_token) return null // el admin no conectó -> el calendario interno sigue funcionando

  const access = await accessTokenFrom(integ.refresh_token)
  const calId = encodeURIComponent(integ.google_calendar_id)
  const attendeeEmails = await attendeeEmailsFor(admin, a.owner_id, a.vet_id)
  const isUpdate = Boolean(a.google_event_id)
  const url = isUpdate
    ? `${CAL_API}/${calId}/events/${encodeURIComponent(a.google_event_id as string)}?sendUpdates=all`
    : `${CAL_API}/${calId}/events?sendUpdates=all`
  const res = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(a, attendeeEmails)),
  })
  if (!res.ok) throw new Error(`Google Calendar ${isUpdate ? "patch" : "insert"} falló (${res.status})`)
  const ev = (await res.json()) as { id?: string }
  if (ev.id && ev.id !== a.google_event_id) {
    await admin.from("appointments").update({ google_event_id: ev.id }).eq("id", a.id)
  }
  return ev.id ?? a.google_event_id
}

// Borra el evento remoto (al eliminar la cita), del calendario del admin de esa clínica.
export async function deleteRemoteEvent(clinicId: string, googleEventId: string): Promise<void> {
  const admin = createAdminClient()
  const adminUserId = await resolveClinicAdmin(admin, clinicId)
  if (!adminUserId) return
  const integ = await getIntegration(admin, adminUserId)
  if (!integ?.refresh_token) return
  const access = await accessTokenFrom(integ.refresh_token)
  const calId = encodeURIComponent(integ.google_calendar_id)
  const res = await fetch(`${CAL_API}/${calId}/events/${encodeURIComponent(googleEventId)}?sendUpdates=all`, {
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

const UPSERT_CHUNK_SIZE = 500

// Pull incremental: trae los cambios del Google Calendar del ADMIN de la clínica desde el último
// syncToken y los aplica en BLOQUE (upsert por chunks, no fila-por-fila: con calendarios grandes, un
// round-trip por evento colgaba la función serverless — incidente 2026-07-31, 1.567 eventos).
// Requiere el índice único appointments(clinic_id, google_event_id) — migración 0042. Devuelve nº de
// eventos procesados. `clinicId`, no `userId`: cualquier vet de la clínica puede disparar el pull,
// pero siempre lee la cuenta del admin (clinics.owner_id).
export async function pullEvents(clinicId: string): Promise<number> {
  const admin = createAdminClient()
  const adminUserId = await resolveClinicAdmin(admin, clinicId)
  if (!adminUserId) return 0
  const integ = await getIntegration(admin, adminUserId)
  if (!integ?.refresh_token) return 0

  const access = await accessTokenFrom(integ.refresh_token)
  const calId = encodeURIComponent(integ.google_calendar_id)

  const upserts: Record<string, unknown>[] = []
  const cancelledIds: string[] = []
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
      await admin.from("calendar_integrations").update({ sync_token: null }).eq("user_id", adminUserId)
      return 0
    }
    if (!res.ok) throw new Error(`Google Calendar list falló (${res.status})`)
    const json = (await res.json()) as {
      items?: GoogleEvent[]
      nextPageToken?: string
      nextSyncToken?: string
    }

    for (const ev of json.items ?? []) {
      if (ev.status === "cancelled") {
        cancelledIds.push(ev.id)
        continue
      }
      const start = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null)
      const end = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null)
      if (!start || !end) continue
      upserts.push({
        clinic_id: clinicId,
        google_event_id: ev.id,
        title: ev.summary ?? "(sin título)",
        notes: ev.description ?? null,
        starts_at: start,
        ends_at: end,
        status: "scheduled",
        updated_at: new Date().toISOString(),
      })
    }

    if (json.nextPageToken) {
      pageToken = json.nextPageToken
      continue
    }
    nextSyncToken = json.nextSyncToken
    break
  }

  // Upsert por chunks: solo toca las columnas listadas arriba (patient_id/owner_id/vet_id/status
  // ya asignados en la app quedan intactos para filas existentes; nuevas filas nacen sin paciente).
  for (let i = 0; i < upserts.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = upserts.slice(i, i + UPSERT_CHUNK_SIZE)
    const { error } = await admin
      .from("appointments")
      .upsert(chunk, { onConflict: "clinic_id,google_event_id" })
    if (error) throw new Error(`Upsert de eventos falló: ${error.message}`)
  }

  // Cancelaciones por chunks (update masivo; no-op si el evento no existía localmente).
  for (let i = 0; i < cancelledIds.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = cancelledIds.slice(i, i + UPSERT_CHUNK_SIZE)
    await admin
      .from("appointments")
      .update({ status: "canceled" })
      .eq("clinic_id", clinicId)
      .in("google_event_id", chunk)
  }

  if (nextSyncToken) {
    await admin.from("calendar_integrations").update({ sync_token: nextSyncToken }).eq("user_id", adminUserId)
  }
  return upserts.length + cancelledIds.length
}

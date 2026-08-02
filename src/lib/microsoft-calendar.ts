// Sincronización con Microsoft Outlook Calendar (Graph API) — SOLO servidor. REST directo (sin
// dependencias), con el cliente service_role para leer el refresh_token del admin y escribir
// microsoft_event_id. Espejo de google-calendar.ts; ver ese archivo para el porqué de cada decisión
// compartida (chunking del pull, best-effort del push, resolución del admin de la clínica, etc).
//
// Config externa requerida: en el entorno del servidor MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
// y SUPABASE_SERVICE_ROLE_KEY; y el proveedor Azure de Supabase configurado para pedir el scope
// `offline_access Calendars.ReadWrite` (ver microsoft-calendar-scope.ts) y devolver refresh token.
//
// Diferencias de Graph frente a Google Calendar que este archivo absorbe:
// - El refresh token solo llega si el scope incluye `offline_access` explícito (Google usa el query
//   param `access_type=offline` en su lugar).
// - No hay "primary": el calendario por defecto se accede vía /me/events (sin id de calendario).
// - El pull incremental es `/me/calendarView/delta`, que a diferencia del syncToken de Google queda
//   ATADO a la ventana de tiempo del primer request — no hay forma de extenderla después sin reiniciar
//   el sync completo. Se usa una ventana de 30 días atrás / 180 adelante (cubre agenda pasada y futura
//   razonable para una clínica).
// - Los `attendees` sí disparan invitación por correo por default al crear/actualizar un evento — a
//   diferencia de Google, Graph no necesita un `sendUpdates=all` explícito.

import { createAdminClient } from "@/lib/supabase/admin"

const GRAPH_API = "https://graph.microsoft.com/v1.0"
const CALENDAR_SCOPE = "offline_access Calendars.ReadWrite"

type Integration = {
  refresh_token: string | null
  google_calendar_id: string // reutiliza la columna genérica de calendar_integrations (id de calendario del proveedor)
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
  microsoft_event_id: string | null
}

// Guarda el refresh token de Microsoft del ADMIN de la clínica (lo llama el /auth/callback cuando su
// login trae uno, o el route /connect en el reconnect explícito — ambos ya validan que quien conecta
// sea clinics.owner_id antes de llegar acá). Idempotente por (user_id, provider).
export async function upsertMicrosoftIntegration(
  userId: string,
  clinicId: string,
  refreshToken: string,
  calendarId = "primary",
): Promise<void> {
  const admin = createAdminClient()
  await admin.from("calendar_integrations").upsert(
    {
      clinic_id: clinicId,
      user_id: userId,
      provider: "microsoft",
      google_calendar_id: calendarId,
      refresh_token: refreshToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  )
}

function microsoftCreds(): { id: string; secret: string; tenant: string } {
  const id = process.env.MICROSOFT_CLIENT_ID
  const secret = process.env.MICROSOFT_CLIENT_SECRET
  if (!id || !secret) {
    throw new Error("Faltan MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET en el servidor")
  }
  const tenant = process.env.MICROSOFT_TENANT_ID || "common"
  return { id, secret, tenant }
}

// Refresca un access token a partir del refresh token del admin.
async function accessTokenFrom(refreshToken: string): Promise<string> {
  const { id, secret, tenant } = microsoftCreds()
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: CALENDAR_SCOPE,
    }),
  })
  if (!res.ok) throw new Error(`Microsoft token refresh falló (${res.status})`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error("Microsoft no devolvió access_token")
  return json.access_token
}

function eventsBaseUrl(calendarId: string): string {
  return calendarId && calendarId !== "primary"
    ? `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/events`
    : `${GRAPH_API}/me/events`
}

// Graph espera dateTime sin sufijo de zona cuando se envía `timeZone` aparte.
function toGraphDateTime(iso: string): string {
  return new Date(iso).toISOString().replace(/Z$/, "")
}

function eventBody(a: AppointmentForSync, attendeeEmails: string[]) {
  const content = [a.reason, a.notes].filter(Boolean).join("\n\n")
  return {
    subject: a.title,
    body: { contentType: "text", content },
    start: { dateTime: toGraphDateTime(a.starts_at), timeZone: "UTC" },
    end: { dateTime: toGraphDateTime(a.ends_at), timeZone: "UTC" },
    ...(attendeeEmails.length
      ? {
          attendees: attendeeEmails.map((email) => ({
            emailAddress: { address: email },
            type: "required",
          })),
        }
      : {}),
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
    .eq("provider", "microsoft")
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

// Push: crea o actualiza el evento en el Outlook Calendar del ADMIN de la clínica de la cita, y
// guarda microsoft_event_id. No-op si el admin no conectó Microsoft. Devuelve el microsoft_event_id
// (o null).
export async function pushAppointment(appointmentId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data: appt } = await admin
    .from("appointments")
    .select("id, clinic_id, title, reason, notes, starts_at, ends_at, owner_id, vet_id, microsoft_event_id")
    .eq("id", appointmentId)
    .maybeSingle()
  if (!appt) return null
  const a = appt as AppointmentForSync

  const adminUserId = await resolveClinicAdmin(admin, a.clinic_id)
  if (!adminUserId) return null
  const integ = await getIntegration(admin, adminUserId)
  if (!integ?.refresh_token) return null // el admin no conectó -> el calendario interno sigue funcionando

  const access = await accessTokenFrom(integ.refresh_token)
  const base = eventsBaseUrl(integ.google_calendar_id)
  const attendeeEmails = await attendeeEmailsFor(admin, a.owner_id, a.vet_id)
  const isUpdate = Boolean(a.microsoft_event_id)
  const url = isUpdate ? `${base}/${encodeURIComponent(a.microsoft_event_id as string)}` : base
  const res = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(a, attendeeEmails)),
  })
  if (!res.ok) throw new Error(`Outlook Calendar ${isUpdate ? "patch" : "insert"} falló (${res.status})`)
  const ev = (await res.json()) as { id?: string }
  if (ev.id && ev.id !== a.microsoft_event_id) {
    await admin.from("appointments").update({ microsoft_event_id: ev.id }).eq("id", a.id)
  }
  return ev.id ?? a.microsoft_event_id
}

// Borra el evento remoto (al eliminar la cita), del calendario del admin de esa clínica.
export async function deleteRemoteEvent(clinicId: string, microsoftEventId: string): Promise<void> {
  const admin = createAdminClient()
  const adminUserId = await resolveClinicAdmin(admin, clinicId)
  if (!adminUserId) return
  const integ = await getIntegration(admin, adminUserId)
  if (!integ?.refresh_token) return
  const access = await accessTokenFrom(integ.refresh_token)
  const base = eventsBaseUrl(integ.google_calendar_id)
  const res = await fetch(`${base}/${encodeURIComponent(microsoftEventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${access}` },
  })
  // 404 = ya borrado; lo tratamos como éxito idempotente.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Outlook Calendar delete falló (${res.status})`)
  }
}

type GraphEvent = {
  id: string
  subject?: string
  bodyPreview?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  "@removed"?: { reason?: string }
}

const UPSERT_CHUNK_SIZE = 500
const INITIAL_WINDOW_PAST_DAYS = 30
const INITIAL_WINDOW_FUTURE_DAYS = 180

function fromGraphDateTime(dateTime: string | undefined): string | null {
  if (!dateTime) return null
  // Graph devuelve la hora en UTC (no pedimos otra zona vía Prefer) sin sufijo 'Z'.
  return new Date(`${dateTime}Z`).toISOString()
}

// Pull incremental: trae los cambios del Outlook Calendar del ADMIN de la clínica desde el último
// deltaLink (guardado en sync_token) y los aplica en BLOQUE (upsert por chunks, no fila-por-fila —
// mismo incidente que motivó el chunking de Google, ver google-calendar.ts). Requiere el índice
// único appointments(clinic_id, microsoft_event_id) — migración 0044/0047. Devuelve nº de eventos
// procesados. `clinicId`, no `userId`: cualquier vet de la clínica puede disparar el pull, pero
// siempre lee la cuenta del admin (clinics.owner_id).
export async function pullEvents(clinicId: string): Promise<number> {
  const admin = createAdminClient()
  const adminUserId = await resolveClinicAdmin(admin, clinicId)
  if (!adminUserId) return 0
  const integ = await getIntegration(admin, adminUserId)
  if (!integ?.refresh_token) return 0

  const access = await accessTokenFrom(integ.refresh_token)
  const calendarId = integ.google_calendar_id
  const base =
    calendarId && calendarId !== "primary"
      ? `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta`
      : `${GRAPH_API}/me/calendarView/delta`

  const upserts: Record<string, unknown>[] = []
  const cancelledIds: string[] = []
  let nextUrl: string
  if (integ.sync_token) {
    nextUrl = integ.sync_token
  } else {
    const params = new URLSearchParams({
      startDateTime: new Date(Date.now() - INITIAL_WINDOW_PAST_DAYS * 864e5).toISOString(),
      endDateTime: new Date(Date.now() + INITIAL_WINDOW_FUTURE_DAYS * 864e5).toISOString(),
    })
    nextUrl = `${base}?${params.toString()}`
  }

  let deltaLink: string | undefined
  for (;;) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${access}`, Prefer: 'odata.track-changes,outlook.timezone="UTC"' },
    })
    if (res.status === 410) {
      // deltaLink vencido/ventana inválida -> reiniciar sync completo la próxima vez.
      await admin.from("calendar_integrations").update({ sync_token: null }).eq("user_id", adminUserId)
      return 0
    }
    if (!res.ok) throw new Error(`Outlook Calendar delta falló (${res.status})`)
    const json = (await res.json()) as {
      value?: GraphEvent[]
      "@odata.nextLink"?: string
      "@odata.deltaLink"?: string
    }

    for (const ev of json.value ?? []) {
      if (ev["@removed"]) {
        cancelledIds.push(ev.id)
        continue
      }
      const start = fromGraphDateTime(ev.start?.dateTime)
      const end = fromGraphDateTime(ev.end?.dateTime)
      if (!start || !end) continue
      upserts.push({
        clinic_id: clinicId,
        microsoft_event_id: ev.id,
        title: ev.subject ?? "(sin título)",
        notes: ev.bodyPreview ?? null,
        starts_at: start,
        ends_at: end,
        status: "scheduled",
        updated_at: new Date().toISOString(),
      })
    }

    if (json["@odata.nextLink"]) {
      nextUrl = json["@odata.nextLink"]
      continue
    }
    deltaLink = json["@odata.deltaLink"]
    break
  }

  // Upsert por chunks: solo toca las columnas listadas arriba (patient_id/owner_id/vet_id/status
  // ya asignados en la app quedan intactos para filas existentes; nuevas filas nacen sin paciente).
  for (let i = 0; i < upserts.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = upserts.slice(i, i + UPSERT_CHUNK_SIZE)
    const { error } = await admin
      .from("appointments")
      .upsert(chunk, { onConflict: "clinic_id,microsoft_event_id" })
    if (error) throw new Error(`Upsert de eventos falló: ${error.message}`)
  }

  // Cancelaciones por chunks (update masivo; no-op si el evento no existía localmente).
  for (let i = 0; i < cancelledIds.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = cancelledIds.slice(i, i + UPSERT_CHUNK_SIZE)
    await admin
      .from("appointments")
      .update({ status: "canceled" })
      .eq("clinic_id", clinicId)
      .in("microsoft_event_id", chunk)
  }

  if (deltaLink) {
    await admin.from("calendar_integrations").update({ sync_token: deltaLink }).eq("user_id", adminUserId)
  }
  return upserts.length + cancelledIds.length
}

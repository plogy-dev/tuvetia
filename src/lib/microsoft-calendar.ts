// Sincronización con Microsoft Outlook Calendar (Graph API) — SOLO servidor. Espejo de
// google-calendar.ts; ver ese archivo para el porqué de cada decisión compartida.
//
// v3 (migración 0049): una sola vía (Tuvetia empuja, no lee) y el evento vive en el calendario del
// VETERINARIO ASIGNADO. La conexión es explícita desde Conexiones.
//
// Config externa requerida: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET y
// SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor.
//
// Diferencias de Graph frente a Google Calendar que este archivo absorbe:
// - El refresh token solo llega si el scope incluye `offline_access` explícito.
// - No hay "primary": el calendario por defecto se accede vía /me/events (sin id de calendario).
// - Los `attendees` disparan invitación por correo por default, sin el `sendUpdates=all` que sí
//   necesita Google.

import { createAdminClient } from "@/lib/supabase/admin"

const GRAPH_API = "https://graph.microsoft.com/v1.0"
const CALENDAR_SCOPE = "offline_access Calendars.ReadWrite"

type Integration = {
  refresh_token: string | null
  google_calendar_id: string // columna genérica de calendar_integrations (id de calendario del proveedor)
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
  calendar_owner_id: string | null
}

// Guarda el refresh token de Microsoft del usuario. Lo llama SOLO el route /connect, con el usuario
// que apretó "Conectar" en Conexiones — ya no hay vinculación automática en el login.
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

/** Desconectar: borra la integración del usuario. Las citas ya empujadas quedan en su calendario. */
export async function deleteMicrosoftIntegration(userId: string): Promise<void> {
  const admin = createAdminClient()
  await admin.from("calendar_integrations").delete().eq("user_id", userId).eq("provider", "microsoft")
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

// Refresca un access token a partir del refresh token del vet.
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
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => ({}))) as {
      error?: string
      error_description?: string
    }
    console.error(`[microsoft-calendar] refresh falló (${res.status}):`, cuerpo)
    const detalle = cuerpo.error_description || cuerpo.error || `HTTP ${res.status}`
    throw new Error(
      `Microsoft rechazó el token guardado: ${detalle}. Puede que haya sido revocado — reconectá Outlook Calendar desde Conexiones.`,
    )
  }
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

async function getIntegration(admin: AdminClient, userId: string): Promise<Integration | null> {
  const { data } = await admin
    .from("calendar_integrations")
    .select("refresh_token, google_calendar_id")
    .eq("user_id", userId)
    .eq("provider", "microsoft")
    .maybeSingle()
  return (data as Integration | null) ?? null
}

// Emails del titular y del vet asignado, para invitarlos como attendees.
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
    const base = eventsBaseUrl(integ.google_calendar_id)
    await fetch(`${base}/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${access}` },
    })
  } catch (e) {
    console.error("[microsoft-calendar] no se pudo limpiar el evento del vet anterior:", e)
  }
}

/**
 * Push: crea o actualiza el evento en el calendario del VETERINARIO ASIGNADO, con el titular y el
 * propio vet como invitados. Devuelve el microsoft_event_id, o null si ese vet no conectó Outlook.
 *
 * Si la cita cambió de veterinario, el evento se borra del calendario del anterior antes de crearse
 * en el del nuevo (ver google-calendar.ts para el porqué).
 */
export async function pushAppointment(appointmentId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data: appt } = await admin
    .from("appointments")
    .select(
      "id, clinic_id, title, reason, notes, starts_at, ends_at, owner_id, vet_id, microsoft_event_id, calendar_owner_id",
    )
    .eq("id", appointmentId)
    .maybeSingle()
  if (!appt) return null
  const a = appt as AppointmentForSync
  if (!a.vet_id) return null // sin veterinario no hay calendario destino

  const cambioDeCalendario = Boolean(
    a.microsoft_event_id && a.calendar_owner_id && a.calendar_owner_id !== a.vet_id,
  )
  if (cambioDeCalendario) {
    await borrarEventoDe(admin, a.calendar_owner_id as string, a.microsoft_event_id as string)
  }

  const integ = await getIntegration(admin, a.vet_id)
  if (!integ?.refresh_token) {
    if (cambioDeCalendario) {
      await admin
        .from("appointments")
        .update({ microsoft_event_id: null, calendar_owner_id: null })
        .eq("id", a.id)
    }
    return null
  }

  const access = await accessTokenFrom(integ.refresh_token)
  const base = eventsBaseUrl(integ.google_calendar_id)
  const attendeeEmails = await attendeeEmailsFor(admin, a.owner_id, a.vet_id)
  const eventIdVigente = cambioDeCalendario ? null : a.microsoft_event_id
  const isUpdate = Boolean(eventIdVigente)
  const url = isUpdate ? `${base}/${encodeURIComponent(eventIdVigente as string)}` : base
  const res = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(a, attendeeEmails)),
  })
  if (!res.ok) throw new Error(`Outlook Calendar ${isUpdate ? "patch" : "insert"} falló (${res.status})`)
  const ev = (await res.json()) as { id?: string }
  const nuevoId = ev.id ?? eventIdVigente
  if (nuevoId !== a.microsoft_event_id || a.calendar_owner_id !== a.vet_id) {
    await admin
      .from("appointments")
      .update({ microsoft_event_id: nuevoId, calendar_owner_id: a.vet_id })
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
  microsoftEventId: string,
): Promise<void> {
  const admin = createAdminClient()
  const integ = await getIntegration(admin, calendarOwnerId)
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

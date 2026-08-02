import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { upsertMicrosoftIntegration } from "@/lib/microsoft-calendar"

// Guarda el refresh_token de Microsoft del ADMINISTRADOR de la clínica (obtenido tras reautorizar
// con el scope Calendars.ReadWrite). Desde 0048_calendar_admin_redesign, hay UNA sola cuenta por
// clínica — solo clinics.owner_id puede conectar. El token llega del navegador una sola vez
// (session.provider_refresh_token) y se persiste server-side.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    refresh_token?: string
    calendar_id?: string
  }
  if (!body.refresh_token) {
    return NextResponse.json({ error: "Falta refresh_token" }, { status: 400 })
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

  const { data: clinic } = await supabase.from("clinics").select("owner_id").eq("id", clinicId).maybeSingle()
  const ownerId = (clinic as { owner_id: string | null } | null)?.owner_id
  if (ownerId !== user.id) {
    return NextResponse.json(
      { error: "Solo el administrador de la clínica puede conectar el calendario" },
      { status: 403 },
    )
  }

  // Una clínica sincroniza con UN proveedor. La UI ya no ofrece el segundo, pero la ruta tiene que
  // negarse igual: acumular dos calendarios deja uno recibiendo citas que nadie mira.
  const { data: otro } = await supabase
    .from("calendar_integrations")
    .select("provider")
    .eq("clinic_id", clinicId)
    .neq("provider", "microsoft")
    .maybeSingle()
  if (otro) {
    return NextResponse.json(
      { error: "Esta clínica ya sincroniza con Google Calendar. Desconectalo antes de conectar Outlook." },
      { status: 409 },
    )
  }

  try {
    await upsertMicrosoftIntegration(user.id, clinicId, body.refresh_token, body.calendar_id || "primary")
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

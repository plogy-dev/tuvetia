import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { upsertGoogleIntegration } from "@/lib/google-calendar"

// Guarda el refresh_token de Google del usuario (obtenido tras reautorizar con scope calendar.events).
// El token llega del navegador una sola vez (session.provider_refresh_token) y se persiste server-side.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    refresh_token?: string
    google_calendar_id?: string
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

  try {
    await upsertGoogleIntegration(
      user.id,
      clinicId,
      body.refresh_token,
      body.google_calendar_id || "primary",
    )
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

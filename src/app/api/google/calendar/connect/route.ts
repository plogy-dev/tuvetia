import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { upsertGoogleIntegration } from "@/lib/google-calendar"

// Conecta el Google Calendar DEL USUARIO que lo pide (calendario v3: uno por persona, elegido a
// mano desde Conexiones — ya no hay vinculación automática en el login, ni calendario de clínica).
// El refresh token llega del navegador una sola vez (session.provider_refresh_token) y se persiste
// server-side.
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

  // El token viene de session.provider_refresh_token, que es el del proveedor con el que se inició
  // sesión — NO necesariamente Google. Pasó en producción: alguien entró con Microsoft y el token
  // de Microsoft terminó guardado en la fila de Google. Se guardaba sin chistar y recién fallaba
  // al sincronizar, con un "invalid_grant" que no señalaba a ningún lado.
  const sessionProvider = (user as unknown as { app_metadata?: { provider?: string } }).app_metadata
    ?.provider
  if (sessionProvider !== "google") {
    return NextResponse.json(
      {
        error: `Esta sesión se inició con ${sessionProvider ?? "otro proveedor"}, así que su token no sirve para Google. Usá el botón "Conectar Google Calendar" para reautorizar con Google.`,
      },
      { status: 400 },
    )
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

  // Un usuario sincroniza con UN proveedor. Para cambiar, se desconecta el otro primero.
  const { data: otro } = await supabase
    .from("calendar_integrations")
    .select("provider")
    .eq("user_id", user.id)
    .neq("provider", "google")
    .maybeSingle()
  if (otro) {
    return NextResponse.json(
      { error: "Ya tenés Outlook Calendar conectado. Desconectalo antes de conectar Google." },
      { status: 409 },
    )
  }

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

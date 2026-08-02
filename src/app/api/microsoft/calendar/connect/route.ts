import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { upsertMicrosoftIntegration } from "@/lib/microsoft-calendar"

// Conecta el Outlook Calendar DEL USUARIO que lo pide. Espejo de la ruta de Google; ver ahí el
// porqué de cada guard.
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

  const sessionProvider = (user as unknown as { app_metadata?: { provider?: string } }).app_metadata
    ?.provider
  if (sessionProvider !== "azure") {
    return NextResponse.json(
      {
        error: `Esta sesión se inició con ${sessionProvider ?? "otro proveedor"}, así que su token no sirve para Outlook. Usá el botón "Conectar Outlook Calendar" para reautorizar con Microsoft.`,
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

  const { data: otro } = await supabase
    .from("calendar_integrations")
    .select("provider")
    .eq("user_id", user.id)
    .neq("provider", "microsoft")
    .maybeSingle()
  if (otro) {
    return NextResponse.json(
      { error: "Ya tenés Google Calendar conectado. Desconectalo antes de conectar Outlook." },
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

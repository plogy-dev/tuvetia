import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { deleteRemoteEvent } from "@/lib/microsoft-calendar"

// Borra el evento remoto de Outlook al eliminar una cita. Espejo de la ruta de Google; ver ahí el
// porqué del `calendar_owner_id` y de la validación de clínica.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    microsoft_event_id?: string
    calendar_owner_id?: string
  }
  if (!body.microsoft_event_id || !body.calendar_owner_id) return NextResponse.json({ ok: true })

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  const { data: duenio } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", body.calendar_owner_id)
    .eq("clinic_id", clinicId ?? "")
    .maybeSingle()
  if (!duenio) return NextResponse.json({ error: "Ese usuario no es de tu clínica" }, { status: 403 })

  try {
    await deleteRemoteEvent(body.calendar_owner_id, body.microsoft_event_id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { deleteRemoteEvent } from "@/lib/google-calendar"

// Borra el evento remoto de Google al eliminar una cita. No-op si no conectó o no hay evento.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { google_event_id?: string }
  if (!body.google_event_id) return NextResponse.json({ ok: true }) // nada que borrar

  try {
    await deleteRemoteEvent(user.id, body.google_event_id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { pushAppointment } from "@/lib/google-calendar"

// Empuja una cita al Google Calendar del usuario (crea o actualiza el evento). No-op si no conectó.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { appointment_id?: string }
  if (!body.appointment_id) {
    return NextResponse.json({ error: "Falta appointment_id" }, { status: 400 })
  }

  try {
    const googleEventId = await pushAppointment(user.id, body.appointment_id)
    return NextResponse.json({ google_event_id: googleEventId })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

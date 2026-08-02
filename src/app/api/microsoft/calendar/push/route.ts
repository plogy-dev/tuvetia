import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { pushAppointment } from "@/lib/microsoft-calendar"

// Empuja una cita al Outlook Calendar del ADMIN de la clínica (crea o actualiza el evento, con el
// titular y el vet asignado como invitados). No-op si el admin no conectó.
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
    const microsoftEventId = await pushAppointment(body.appointment_id)
    return NextResponse.json({ microsoft_event_id: microsoftEventId })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

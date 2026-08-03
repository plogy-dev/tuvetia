import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { deleteRemoteEvent } from "@/lib/microsoft-calendar"

// Borra el evento remoto de Outlook al eliminar una cita. Espejo de la ruta de Google; ver ahí por
// qué esta ruta recibe el `appointment_id` y no el id del evento (resumen: recibirlo del navegador
// permitía borrar cualquier evento del calendario PERSONAL de un colega, porque nada ataba ese id a
// ninguna cita).
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

  const { data: cita } = await supabase
    .from("appointments")
    .select("microsoft_event_id, calendar_owner_id")
    .eq("id", body.appointment_id)
    .maybeSingle()

  if (!cita) return NextResponse.json({ error: "La cita no existe" }, { status: 404 })

  const { microsoft_event_id: eventId, calendar_owner_id: ownerId } = cita as {
    microsoft_event_id: string | null
    calendar_owner_id: string | null
  }
  if (!eventId || !ownerId) return NextResponse.json({ ok: true })

  try {
    await deleteRemoteEvent(ownerId, eventId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

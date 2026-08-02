import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { pushAppointment } from "@/lib/microsoft-calendar"

// Empuja una cita al Outlook Calendar del VETERINARIO ASIGNADO (crea o actualiza el evento, con el
// titular y el propio vet como invitados). No-op si ese vet no conectó Outlook.
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

  // Mismo chequeo que la ruta de Google: `pushAppointment` usa service_role y se salta la RLS, así
  // que primero se confirma con la SESIÓN que esa cita es visible para quien la pide.
  const { data: cita } = await supabase
    .from("appointments")
    .select("id")
    .eq("id", body.appointment_id)
    .maybeSingle()
  if (!cita) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 })

  try {
    const microsoftEventId = await pushAppointment(body.appointment_id)
    return NextResponse.json({ microsoft_event_id: microsoftEventId })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

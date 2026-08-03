import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { empujarCita } from "@/lib/composio/calendario"

// Empuja una cita al Google Calendar del VETERINARIO ASIGNADO (crea o actualiza el evento, con el
// titular y el propio vet como invitados). No-op si ese vet no conectó Google.
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

  // `empujarCita` corre con service_role, que se salta la RLS: sin este chequeo cualquiera
  // podría empujar una cita de OTRA clínica y meterle un evento en el calendario a su veterinario.
  // La lectura va con la sesión, así que la RLS decide si esa cita existe para quien pregunta.
  const { data: cita } = await supabase
    .from("appointments")
    .select("id")
    .eq("id", body.appointment_id)
    .maybeSingle()
  if (!cita) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 })

  try {
    const { eventId, motivo } = await empujarCita(body.appointment_id)
    // `motivo` viaja al front para que pueda decir POR QUÉ la cita no llegó al calendario. Antes
    // esta ruta sólo devolvía el id y un null era mudo.
    return NextResponse.json({ google_event_id: eventId, motivo })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

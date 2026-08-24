import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { empujarCita } from "@/lib/composio/calendario"

export const runtime = "nodejs"

// Empuja una cita al calendario del VETERINARIO ASIGNADO —con el del administrador de respaldo—
// creando o actualizando el evento, con el titular, todos los administradores y quien la agendó
// invitados (v5).
//
// Una sola ruta para los dos proveedores: en el calendario de quién vive el evento y qué proveedor
// lo recibe lo decide el servidor. Antes había una ruta por proveedor y el navegador llamaba a las
// dos sin saber cuál servía, lo que además obligaba a adivinar de cuál venía cada respuesta.
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

  // `empujarCita` corre con service_role, que se salta la RLS: sin este chequeo cualquiera podría
  // empujar una cita de OTRA clínica y meterle un evento en el calendario a alguien de ese equipo. La
  // lectura va con la sesión, así que la RLS decide si esa cita existe para quien pregunta.
  const { data: cita } = await supabase
    .from("appointments")
    .select("id")
    .eq("id", body.appointment_id)
    .maybeSingle()
  if (!cita) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 })

  try {
    const { eventId, motivo } = await empujarCita(body.appointment_id)
    // `motivo` viaja al front para que pueda decir POR QUÉ la cita no llegó al calendario. Un null
    // a secas era mudo, y ese silencio ya costó una tarde de depuración.
    return NextResponse.json({ event_id: eventId, motivo })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { deleteRemoteEvent } from "@/lib/google-calendar"

// Borra el evento remoto al eliminar una cita. El evento vive en el calendario del veterinario que
// la atendía, así que el cliente manda quién era (`calendar_owner_id`, capturado antes de borrar la
// fila — después ya no se puede consultar). No-op si ese vet no tiene Google conectado.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    google_event_id?: string
    calendar_owner_id?: string
  }
  // Sin evento o sin dueño no hay nada que borrar (la cita nunca llegó a un calendario).
  if (!body.google_event_id || !body.calendar_owner_id) return NextResponse.json({ ok: true })

  // El dueño del calendario tiene que ser de la misma clínica que quien pide el borrado: sin esto,
  // el id llega del navegador y podría apuntar al calendario de cualquiera.
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
    await deleteRemoteEvent(body.calendar_owner_id, body.google_event_id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

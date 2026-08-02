import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { deleteRemoteEvent } from "@/lib/microsoft-calendar"

// Borra el evento remoto de Outlook (calendario del admin de la clínica) al eliminar una cita.
// No-op si el admin no conectó o no hay evento.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { microsoft_event_id?: string }
  if (!body.microsoft_event_id) return NextResponse.json({ ok: true }) // nada que borrar

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

  try {
    await deleteRemoteEvent(clinicId, body.microsoft_event_id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { borrarEventoRemoto } from "@/lib/composio/calendario"

// Borra el evento remoto al eliminar una cita. El evento vive en el calendario del veterinario que
// la atendía, así que se borra con LAS CREDENCIALES DE ESE VET — no con las de quien aprieta el botón.
//
// Por eso esta ruta recibe el `appointment_id` y NO el id del evento. Antes recibía
// `google_event_id` + `calendar_owner_id` del navegador y sólo verificaba que el dueño fuera de la
// misma clínica; nada ataba ese evento a ninguna cita. O sea que cualquier miembro autenticado podía
// mandar el id de un evento cualquiera del calendario PERSONAL de un colega y Tuvetia se lo borraba,
// con `sendUpdates=all`. Validar el dueño no alcanzaba: el agujero estaba en el otro campo.
//
// Ahora los dos ids salen de la FILA, leída con la sesión del llamador: la policy
// `appointments_select` (`clinic_id = private.my_clinic_id()`) hace que una cita de otra clínica
// simplemente no exista. El navegador ya no elige qué se borra.
//
// ⚠️ Se llama ANTES de borrar la fila. Si se llamara después no habría contra qué validar — que es
// exactamente cómo nació el problema.
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
    .select("google_event_id, calendar_owner_id")
    .eq("id", body.appointment_id)
    .maybeSingle()

  // No existe, o es de otra clínica y la RLS no la muestra. Se responde igual en los dos casos:
  // distinguirlos confirmaría que esa cita existe en algún lado.
  if (!cita) return NextResponse.json({ error: "La cita no existe" }, { status: 404 })

  const { google_event_id: eventId, calendar_owner_id: ownerId } = cita as {
    google_event_id: string | null
    calendar_owner_id: string | null
  }
  // La cita nunca llegó a un calendario de Google: no hay nada que borrar.
  if (!eventId || !ownerId) return NextResponse.json({ ok: true })

  try {
    await borrarEventoRemoto(ownerId, eventId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { borrarEventoRemoto } from "@/lib/composio/calendario"

export const runtime = "nodejs"

// Borra el evento remoto al eliminar una cita. El evento vive en el calendario de quien lo hospeda
// —el veterinario asignado, o el administrador de respaldo (v5)— así que se borra con LA CONEXIÓN DE
// ESA PERSONA, no con la de quien aprieta el botón. De quién es sale de `calendar_owner_id`, que la
// fila guarda justamente para esto.
//
// Por eso esta ruta recibe el `appointment_id` y NO el id del evento. Antes recibía el id del evento
// y el dueño desde el navegador, y sólo verificaba que el dueño fuera de la misma clínica; nada
// ataba ese evento a ninguna cita. O sea que cualquier miembro autenticado podía mandar el id de un
// evento cualquiera del calendario PERSONAL de un colega y Tuvetia se lo borraba, notificando a los
// invitados. Validar el dueño no alcanzaba: el agujero estaba en el otro campo.
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
    .select("google_event_id, microsoft_event_id, calendar_owner_id")
    .eq("id", body.appointment_id)
    .maybeSingle()

  // No existe, o es de otra clínica y la RLS no la muestra. Se responde igual en los dos casos:
  // distinguirlos confirmaría que esa cita existe en algún lado.
  if (!cita) return NextResponse.json({ error: "La cita no existe" }, { status: 404 })

  const fila = cita as {
    google_event_id: string | null
    microsoft_event_id: string | null
    calendar_owner_id: string | null
  }
  // De qué proveedor es el evento sale de QUÉ COLUMNA tiene el id, no de lo que esté conectado hoy:
  // la conexión pudo cambiar desde que se creó y el evento sigue donde quedó.
  const evento = fila.google_event_id
    ? { id: fila.google_event_id, proveedor: "google" as const }
    : fila.microsoft_event_id
      ? { id: fila.microsoft_event_id, proveedor: "outlook" as const }
      : null

  // La cita nunca llegó a un calendario: no hay nada que borrar.
  if (!evento || !fila.calendar_owner_id) return NextResponse.json({ ok: true })

  try {
    await borrarEventoRemoto(fila.calendar_owner_id, evento.id, evento.proveedor)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

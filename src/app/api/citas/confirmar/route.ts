import { NextResponse } from "next/server"

import { sesionDelServidor } from "@/lib/supabase/sesion"
import { confirmarCita } from "@/lib/citas/confirmacion"

export const runtime = "nodejs"

// Avisarle al titular por WhatsApp que su cita quedó agendada, en el momento de agendarla.
//
// LA CLÍNICA SALE DE LA SESIÓN Y NUNCA DEL CUERPO DEL PEDIDO. `confirmarCita` corre con
// `service_role` —necesita leer el teléfono del titular, que la RLS del llamador no siempre alcanza—
// así que si el `clinic_id` viniera del navegador, cualquiera con sesión podría pedir la
// confirmación de una cita de otra clínica y ver a qué número salió.
//
// El resultado se devuelve entero, incluido el motivo cuando no salió: la pantalla lo muestra en la
// ventana de confirmación, y cada motivo se arregla en un lugar distinto.

export async function POST(req: Request) {
  const { supabase, user } = await sesionDelServidor()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  // La clínica se lee del perfil CON LA SESIÓN, no del cuerpo del pedido: es lo que ata la
  // confirmación a quien la está pidiendo.
  const { data: perfil } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (perfil as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) {
    return NextResponse.json({ error: "Sin clínica activa" }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as { appointment_id?: string }
  if (!body.appointment_id) {
    return NextResponse.json({ error: "Falta appointment_id" }, { status: 400 })
  }

  return NextResponse.json(await confirmarCita(body.appointment_id, clinicId))
}

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { clinicaDeLaSesion } from "@/lib/api/clinica-de-la-sesion"
import { cancelarSuscripcion } from "@/lib/suscripcion/motor"

// Cancelar la renovación.
//
// NO BAJA EL PLAN EN EL ACTO ni borra la tarjeta: marca la cancelación y el barrido diario baja la
// clínica cuando termina el período que ya pagó. Ver `motor.ts :: cancelarSuscripcion`.
//
// SIN PASO DE CONFIRMACIÓN EN EL SERVIDOR. La confirmación es de la interfaz; repetirla acá con un
// campo tipo `{ confirmo: true }` sólo da la ilusión de una barrera — cualquiera que llame a esta
// ruta a mano lo manda igual.

export const dynamic = "force-dynamic"

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  if (sesion.role !== "admin") {
    return NextResponse.json(
      { error: "Sólo el administrador de la clínica puede cancelar el plan." },
      { status: 403 },
    )
  }

  const res = await cancelarSuscripcion(sesion.clinicId)
  if (!res.ok) return NextResponse.json({ error: res.mensaje }, { status: 400 })

  return NextResponse.json({ ok: true, mensaje: res.mensaje })
}

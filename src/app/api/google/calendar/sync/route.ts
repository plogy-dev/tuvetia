import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { pullEvents } from "@/lib/google-calendar"

// Pull incremental: trae los cambios del Google Calendar del ADMIN de la clínica y los aplica a la
// BD local. Cualquier vet autenticado de la clínica puede disparar esto (es de solo lectura hacia
// la BD); `pullEvents` siempre resuelve la cuenta del admin, no la de quien llama.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

  try {
    const changed = await pullEvents(clinicId)
    return NextResponse.json({ changed })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

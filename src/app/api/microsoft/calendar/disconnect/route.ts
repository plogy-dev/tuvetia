import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { deleteMicrosoftIntegration } from "@/lib/microsoft-calendar"

// Desconecta el Outlook Calendar del usuario. Espejo de la ruta de Google; ver ahí el detalle.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  try {
    await deleteMicrosoftIntegration(user.id)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { deleteGoogleIntegration } from "@/lib/google-calendar"

// Desconecta el Google Calendar del usuario: borra su credencial. Las citas que ya se empujaron
// quedan en su calendario — sacarlas sería borrarle eventos de su agenda sin que lo haya pedido.
// Desde acá también se cambia de proveedor: desconectar Google habilita conectar Outlook.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  try {
    await deleteGoogleIntegration(user.id)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

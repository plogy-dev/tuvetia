import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { desconectarCalendario } from "@/lib/composio/calendario"

export const runtime = "nodejs"

// Desconecta el calendario del veterinario. Las citas ya empujadas QUEDAN en su calendario: sacarlas
// sería borrarle eventos de su agenda sin que lo haya pedido.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  try {
    await desconectarCalendario(user.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

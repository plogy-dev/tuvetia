import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { desconectar } from "@/lib/composio/gmail"

export const runtime = "nodejs"

// Desconecta el Gmail del miembro que lo pide. Borra la cuenta del lado de Composio: a partir de
// ahí Athos deja de poder leer o escribir por él. Los correos ya enviados quedan donde están.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  try {
    await desconectar(user.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

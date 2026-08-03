import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { desconectar } from "@/lib/composio/correo"

export const runtime = "nodejs"

// Desconecta el correo del miembro que lo pide, sea Gmail u Outlook. Borra la cuenta del lado de
// Composio: a partir de ahí Athos deja de poder leer o escribir por él. Lo ya enviado queda donde
// está.
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

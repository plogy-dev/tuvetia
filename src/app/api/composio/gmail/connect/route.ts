import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { iniciarConexion } from "@/lib/composio/gmail"

export const runtime = "nodejs"

// Empieza la conexión del Gmail del MIEMBRO que la pide. Devuelve la URL de Google a la que el
// navegador tiene que ir; el token queda del lado de Composio y nunca pasa por acá.
//
// El `userId` de Composio es nuestro `profiles.id`: por eso la cuenta que conecta esta persona es
// exactamente la que Athos va a usar cuando esta persona le pida algo.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || ""
  const callbackUrl = `${origin}/dashboard/conexiones?correo=conectado`

  try {
    const url = await iniciarConexion(user.id, callbackUrl)
    return NextResponse.json({ url })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

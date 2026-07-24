import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { pullEvents } from "@/lib/google-calendar"

// Pull incremental: trae los cambios de Google Calendar del usuario y los aplica a la BD local.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  try {
    const changed = await pullEvents(user.id)
    return NextResponse.json({ changed })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { syncInboxForUser } from "@/lib/email/inbox"

export const runtime = "nodejs"
export const maxDuration = 120 // IMAP puede tardar con un buzón grande

// Barrido a demanda del buzón, para el botón "Actualizar". El cron corre cada ~15 min (workflow
// cartera-sweep) y solo en horario hábil; esto es la salida para cuando alguien no quiere esperar.
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
    const r = await syncInboxForUser(clinicId, user.id)
    return NextResponse.json({ ok: true, fetched: r.fetched, stored: r.stored })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Cambia el modo del agente de WhatsApp de la clínica (review = Athos solo sugiere; auto = Athos
// responde solo entrantes NO clínicos). Escritura con service_role tras validar la sesión —
// whatsapp_integrations no tiene policies de escritura para clientes.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const parsed = z
    .object({ mode: z.enum(["review", "auto"]) })
    .safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 })

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from("whatsapp_integrations")
    .update({ agent_mode: parsed.data.mode, updated_at: new Date().toISOString() })
    .eq("clinic_id", clinicId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin.from("audit_logs").insert({
    clinic_id: clinicId,
    user_id: user.id,
    action: `whatsapp.agent_mode.${parsed.data.mode}`,
    table_name: "whatsapp_integrations",
    payload: { mode: parsed.data.mode },
  })
  return NextResponse.json({ ok: true, mode: parsed.data.mode })
}

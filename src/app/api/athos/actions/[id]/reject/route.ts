import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"

// Rechaza una acción propuesta por Athos. Queda auditada (a diferencia del borrador efímero de
// antes: ahora sabemos qué propuso Athos y qué decidió el vet).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const { data: actionData } = await supabase
    .from("athos_actions")
    .select("id, clinic_id, status, tool_name")
    .eq("id", id)
    .maybeSingle()
  const action = actionData as { id: string; clinic_id: string; status: string; tool_name: string } | null
  if (!action) return NextResponse.json({ error: "Acción no encontrada" }, { status: 404 })
  if (action.status !== "proposed")
    return NextResponse.json({ error: `La acción ya está en estado "${action.status}"` }, { status: 409 })

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin
    .from("athos_actions")
    .update({ status: "rejected", reviewed_by: user.id, reviewed_at: now, updated_at: now })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin.from("audit_logs").insert({
    clinic_id: action.clinic_id,
    user_id: user.id,
    action: "athos_action.rejected",
    table_name: "athos_actions",
    record_id: action.id,
    payload: { tool_name: action.tool_name },
  })
  return NextResponse.json({ ok: true })
}

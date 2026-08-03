import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireClinicAdmin } from "@/lib/clinic-role"

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

  // SOLO ADMIN. `agent_mode='auto'` es el ÚNICO interruptor de autorización de las dos rutas que le
  // hablan solas a los titulares (`whatsapp/auto-reply.ts` y `cartera/wa-router.ts`). Todo lo demás
  // en esa cadena —debounce de 5 s, reserva atómica del entrante, rampa de calentamiento, 8/hora,
  // límite diario— son frenos de VOLUMEN, no de permiso: ninguno pregunta quién lo encendió.
  //
  // El `audit_logs` de más abajo deja rastro DESPUÉS del hecho; esto es lo que lo previene.
  let clinicId: string
  try {
    ;({ clinicId } = await requireClinicAdmin())
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

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

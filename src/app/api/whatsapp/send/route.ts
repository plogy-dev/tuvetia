import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { sendTextMessage } from "@/lib/kapso"

// Envía un WhatsApp desde el número conectado de la clínica (vía Kapso) y registra el saliente en
// whatsapp_messages (direction=outbound, sent_by). El webhook actualizará delivered_at/read_at.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { to?: string; body?: string; owner_id?: string | null }
  const to = body.to?.replace(/[^\d+]/g, "") ?? ""
  const text = body.body?.trim() ?? ""
  if (!to || !text) return NextResponse.json({ error: "Faltan destinatario o mensaje" }, { status: 400 })

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

  try {
    const admin = createAdminClient()
    const { data: integ } = await admin
      .from("whatsapp_integrations")
      .select("status, phone_number, kapso_phone_number_id")
      .eq("clinic_id", clinicId)
      .maybeSingle()
    const i = integ as {
      status: string
      phone_number: string | null
      kapso_phone_number_id: string | null
    } | null
    if (i?.status !== "connected" || !i.kapso_phone_number_id) {
      return NextResponse.json(
        { error: "WhatsApp no está conectado. Verificá la conexión en Configuración → WhatsApp." },
        { status: 409 },
      )
    }

    const waMessageId = await sendTextMessage(i.kapso_phone_number_id, to.replace(/\D/g, ""), text)

    const { error: insErr } = await admin.from("whatsapp_messages").insert({
      clinic_id: clinicId,
      owner_id: body.owner_id ?? null,
      wa_message_id: waMessageId,
      wa_phone_from: i.phone_number ?? "",
      wa_phone_to: to,
      direction: "outbound",
      body: text,
      sent_by: user.id,
    })
    if (insErr) console.error("No se pudo registrar el mensaje saliente:", insErr)

    return NextResponse.json({ ok: true, wa_message_id: waMessageId })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

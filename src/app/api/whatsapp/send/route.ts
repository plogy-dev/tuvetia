import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { sendWhatsAppText } from "@/lib/whatsapp/send-message"

// Envía un WhatsApp desde el número conectado de la clínica (proveedor según el tenant: Kapso o
// Meta directo) y registra el saliente. El webhook actualizará delivered_at/read_at/failed_at.
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
    const { waMessageId, message } = await sendWhatsAppText(clinicId, to, text, {
      ownerId: body.owner_id ?? null,
      sentBy: user.id,
    })
    return NextResponse.json({
      ok: true,
      wa_message_id: waMessageId,
      message, // fila real (id + created_at): el front la usa para no duplicar el hilo
      ...(message ? {} : { warning: "El mensaje se envió pero no quedó registrado en el hilo." }),
    })
  } catch (e) {
    const msg = (e as Error).message
    const notConnected = msg.includes("no está conectado")
    if (!notConnected) console.error("whatsapp/send:", e)
    return NextResponse.json(
      { error: notConnected ? msg : "No se pudo enviar el mensaje. Intenta de nuevo." },
      { status: notConnected ? 409 : 502 },
    )
  }
}

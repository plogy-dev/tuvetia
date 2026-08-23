import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { clinicaDeLaSesion } from "@/lib/api/clinica-de-la-sesion"
import { sendWhatsAppText } from "@/lib/whatsapp/send-message"
import { clasificarFalloDeEnvio } from "@/lib/whatsapp/error-de-envio"

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

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  const { clinicId } = sesion

  try {
    const { waMessageId, message } = await sendWhatsAppText(clinicId, to, text, {
      ownerId: body.owner_id ?? null,
      sentBy: user.id,
      // LO TECLEÓ UNA PERSONA. Es la bandeja: el vet eligió el destinatario, así que no hay cerco
      // — es su WhatsApp y su cliente, esté o no cargado todavía en el CRM.
      origen: "humano",
    })
    return NextResponse.json({
      ok: true,
      wa_message_id: waMessageId,
      message, // fila real (id + created_at): el front la usa para no duplicar el hilo
      ...(message ? {} : { warning: "El mensaje se envió pero no quedó registrado en el hilo." }),
    })
  } catch (e) {
    // El detalle completo va SIEMPRE al log del servidor (incluido el caso "no conectado", que antes
    // no se logueaba: era el único que se podía diagnosticar por el texto y aun así conviene tener
    // la traza). Al vet le llega la clase del fallo, que es lo que le permite decidir.
    console.error("whatsapp/send:", e)
    const fallo = clasificarFalloDeEnvio(e)
    return NextResponse.json({ error: fallo.texto }, { status: fallo.status })
  }
}

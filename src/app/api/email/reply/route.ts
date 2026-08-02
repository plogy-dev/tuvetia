import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { sendClinicEmail } from "@/lib/email/send-clinic-email"

export const runtime = "nodejs"

// Responder un hilo desde la bandeja. El destinatario y el asunto NO vienen del navegador: se
// resuelven del hilo en el servidor, que es lo que garantiza que la respuesta llegue a quien
// escribió y quede dentro del hilo.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { thread_id?: string; body?: string }
  if (!body.thread_id || !body.body?.trim()) {
    return NextResponse.json({ error: "Falta el hilo o el cuerpo" }, { status: 400 })
  }

  // La lectura va con la SESIÓN: la RLS decide si ese hilo existe para quien pregunta. Sin esto, un
  // thread_id de otra clínica llegaría igual a `sendClinicEmail`, que corre con service_role.
  const { data: hilo } = await supabase
    .from("email_threads")
    .select("id, clinic_id, participants, owner_id")
    .eq("id", body.thread_id)
    .maybeSingle()
  if (!hilo) return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 })
  const h = hilo as {
    id: string
    clinic_id: string
    participants: string[] | null
    owner_id: string | null
  }

  const destino = (h.participants ?? [])[0]
  if (!destino) {
    return NextResponse.json({ error: "El hilo no tiene destinatario" }, { status: 400 })
  }

  try {
    const r = await sendClinicEmail(h.clinic_id, {
      to: destino,
      body: body.body.trim(),
      threadId: h.id,
      ownerId: h.owner_id,
      sentBy: user.id,
    })
    return NextResponse.json({ ok: true, message_id: r.messageId, aviso: r.warning ?? null })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

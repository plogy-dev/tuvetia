import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { responderCorreo } from "@/lib/composio/correo"

export const runtime = "nodejs"

// Responder desde la bandeja. Sale de la cuenta del propio veterinario (vía Composio), no de una
// cuenta de la clínica: el titular le responde a la persona que le escribió.
//
// `thread_id` es la referencia de la conversación que devolvió la búsqueda (el hilo en Gmail, el
// mensaje en Outlook): es lo que hace que la respuesta quede DENTRO en vez de abrir una nueva.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    thread_id?: string
    to_email?: string
    subject?: string
    body?: string
  }
  if (!body.thread_id || !body.to_email || !body.body?.trim()) {
    return NextResponse.json({ error: "Faltan datos para responder" }, { status: 400 })
  }

  // Un solo "Re:", no una escalera — los clientes de correo la acumulan y además rompe el agrupado
  // por asunto que algunos webmails hacen de respaldo.
  const asunto = (body.subject ?? "").replace(/^\s*(re|rv|fwd?)\s*:\s*/i, "").trim()

  const r = await responderCorreo(user.id, {
    ref: body.thread_id,
    a: body.to_email.trim(),
    asunto: asunto ? `Re: ${asunto}` : "Re:",
    cuerpo: body.body.trim(),
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
  return NextResponse.json({ ok: true })
}

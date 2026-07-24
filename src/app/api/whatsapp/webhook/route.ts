import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"

// Webhook de mensajes de WhatsApp (Kapso en modo "meta": reenvío crudo del payload de la Cloud API
// de Meta — formato estable y documentado). Registrar en Kapso apuntando a:
//   https://<dominio>/api/whatsapp/webhook?secret=<KAPSO_WEBHOOK_SECRET>
//
// Qué hace: upsert idempotente de mensajes ENTRANTES en whatsapp_messages (por wa_message_id,
// unique) + actualización de delivered_at/read_at con los statuses. El clinic_id se resuelve por el
// número conectado (whatsapp_integrations.phone_number); el owner por teléfono (dígitos finales).
// Todo con service_role — la RLS del cliente queda intacta.

type MetaMessage = {
  id: string
  from: string
  timestamp?: string
  type?: string
  text?: { body?: string }
}
type MetaStatus = { id: string; status?: string; timestamp?: string }
type MetaValue = {
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  messages?: MetaMessage[]
  statuses?: MetaStatus[]
}
type MetaPayload = { entry?: { changes?: { value?: MetaValue }[] }[] }

const digits = (s: string) => s.replace(/\D/g, "")

export async function POST(req: Request) {
  const secret = process.env.KAPSO_WEBHOOK_SECRET
  if (!secret) return new Response("Webhook no configurado", { status: 503 })
  const url = new URL(req.url)
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-webhook-secret")
  if (provided !== secret) return new Response("Unauthorized", { status: 401 })

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return new Response("Falta SUPABASE_SERVICE_ROLE_KEY", { status: 503 })
  }

  const payload = (await req.json().catch(() => null)) as MetaPayload | null
  if (!payload?.entry) return NextResponse.json({ ok: true, ignored: true })

  // Integraciones conectadas: para resolver clinic_id por número receptor.
  const { data: integs } = await admin
    .from("whatsapp_integrations")
    .select("clinic_id, phone_number")
  const integrations = (integs ?? []) as { clinic_id: string; phone_number: string | null }[]

  function clinicFor(displayPhone?: string): string | null {
    if (displayPhone) {
      const d = digits(displayPhone)
      const hit = integrations.find((i) => i.phone_number && digits(i.phone_number) === d)
      if (hit) return hit.clinic_id
    }
    // Piloto: si hay una sola clínica conectada, todo mensaje es suyo.
    return integrations.length === 1 ? integrations[0].clinic_id : null
  }

  let inserted = 0
  let updated = 0

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value) continue
      const clinicId = clinicFor(value.metadata?.display_phone_number)

      // Mensajes entrantes
      for (const m of value.messages ?? []) {
        if (!clinicId) continue // sin clínica resoluble no insertamos (clinic_id es NOT NULL)
        // Match del titular por los últimos 10 dígitos del teléfono.
        const from = digits(m.from)
        const { data: owner } = await admin
          .from("owners")
          .select("id")
          .eq("clinic_id", clinicId)
          .ilike("phone", `%${from.slice(-10)}%`)
          .maybeSingle()
        const { error } = await admin.from("whatsapp_messages").upsert(
          {
            clinic_id: clinicId,
            owner_id: (owner as { id: string } | null)?.id ?? null,
            wa_message_id: m.id,
            wa_phone_from: m.from,
            wa_phone_to: value.metadata?.display_phone_number ?? "",
            direction: "inbound",
            body: m.text?.body ?? null,
            media_type: m.type && m.type !== "text" ? m.type : null,
          },
          { onConflict: "wa_message_id", ignoreDuplicates: true },
        )
        if (!error) inserted += 1
      }

      // Estados de entrega/lectura de mensajes salientes
      for (const s of value.statuses ?? []) {
        const ts = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString()
        const patch =
          s.status === "read"
            ? { read_at: ts, delivered_at: ts }
            : s.status === "delivered"
              ? { delivered_at: ts }
              : null
        if (!patch) continue
        const { error } = await admin.from("whatsapp_messages").update(patch).eq("wa_message_id", s.id)
        if (!error) updated += 1
      }
    }
  }

  return NextResponse.json({ ok: true, inserted, updated })
}

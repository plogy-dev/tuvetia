import { NextResponse, after } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifyMetaSignature, verifySharedSecret } from "@/lib/whatsapp/verify"
import { routeInbound } from "@/lib/whatsapp/inbound-router"

export const maxDuration = 60 // after(): debounce de 5 s + modelo liviano del modo auto

// Webhook de mensajes de WhatsApp. Kapso reenvía el payload crudo de la Cloud API de Meta
// (formato estable), así que este parser sirve igual para Kapso hoy y Meta directo mañana.
//
// Autenticación (en orden):
//  1. X-Hub-Signature-256 + META_APP_SECRET (Meta directo) — HMAC del body crudo.
//  2. Header x-webhook-secret == KAPSO_WEBHOOK_SECRET (Kapso).
//  3. Query ?secret= — DEPRECADO (queda en logs de proxies/CDN): re-registrar el webhook en Kapso
//     con el header y eliminar este fallback.
//
// Resolución de tenant: por value.metadata.phone_number_id contra kapso_phone_number_id
// (status=connected); fallback por display_phone_number exacto. Sin heurísticas de "única clínica".
// Todo con service_role — la RLS del cliente queda intacta.

type MetaMessage = {
  id: string
  from: string
  timestamp?: string
  type?: string
  text?: { body?: string }
}
type MetaStatus = {
  id: string
  status?: string
  timestamp?: string
  errors?: { code?: number; title?: string; message?: string }[]
}
type MetaValue = {
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  messages?: MetaMessage[]
  statuses?: MetaStatus[]
}
type MetaPayload = { entry?: { changes?: { value?: MetaValue }[] }[] }

const digits = (s: string) => s.replace(/\D/g, "")

// Challenge de verificación de Meta (hub.mode/hub.verify_token/hub.challenge). Kapso no lo usa,
// pero Meta lo exige al registrar el webhook — prerequisito de la migración a Cloud API directa.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN
  if (
    verifyToken &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === verifyToken
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 })
  }
  return new Response("Forbidden", { status: 403 })
}

export async function POST(req: Request) {
  const raw = await req.text()

  // 1) Firma de Meta (cuando esté configurada, es la vía preferida).
  const metaSecret = process.env.META_APP_SECRET
  const metaSig = req.headers.get("x-hub-signature-256")
  let authorized = Boolean(metaSecret && metaSig && verifyMetaSignature(raw, metaSig, metaSecret))

  // 2) Shared secret de Kapso (header; query deprecado).
  if (!authorized) {
    const secret = process.env.KAPSO_WEBHOOK_SECRET
    if (!secret) return new Response("Webhook no configurado", { status: 503 })
    const provided =
      req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("secret")
    authorized = verifySharedSecret(provided, secret)
  }
  if (!authorized) return new Response("Unauthorized", { status: 401 })

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return new Response("Falta SUPABASE_SERVICE_ROLE_KEY", { status: 503 })
  }

  let payload: MetaPayload | null = null
  try {
    payload = JSON.parse(raw) as MetaPayload
  } catch {
    payload = null
  }
  if (!payload?.entry) return NextResponse.json({ ok: true, ignored: true })

  // Integraciones CONECTADAS: el tenant se resuelve por el número receptor del payload.
  const { data: integs } = await admin
    .from("whatsapp_integrations")
    .select("clinic_id, phone_number, kapso_phone_number_id, meta_phone_number_id")
    .eq("status", "connected")
  const integrations = (integs ?? []) as {
    clinic_id: string
    phone_number: string | null
    kapso_phone_number_id: string | null
    meta_phone_number_id: string | null
  }[]

  function clinicFor(value: MetaValue): string | null {
    // 1) phone_number_id de Meta: viene siempre en el payload y es único por número.
    //    Cubre ambos proveedores durante la transición (Kapso passthrough y Meta directo).
    const pnId = value.metadata?.phone_number_id
    if (pnId) {
      const hit = integrations.find(
        (i) => i.kapso_phone_number_id === pnId || i.meta_phone_number_id === pnId,
      )
      if (hit) return hit.clinic_id
    }
    // 2) Fallback exacto por display_phone_number.
    const displayPhone = value.metadata?.display_phone_number
    if (displayPhone) {
      const d = digits(displayPhone)
      const hit = integrations.find((i) => i.phone_number && digits(i.phone_number) === d)
      if (hit) return hit.clinic_id
    }
    return null
  }

  let inserted = 0
  let updated = 0

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value) continue
      const clinicId = clinicFor(value)
      if (!clinicId) {
        // Nunca descartar en silencio: es pérdida de datos y nadie se entera.
        if (value.messages?.length || value.statuses?.length) {
          console.warn(
            "whatsapp/webhook: evento sin clínica resoluble",
            JSON.stringify({
              phone_number_id: value.metadata?.phone_number_id,
              display_phone_number: value.metadata?.display_phone_number,
              messages: value.messages?.length ?? 0,
              statuses: value.statuses?.length ?? 0,
            }),
          )
        }
        continue
      }

      // Mensajes entrantes
      for (const m of value.messages ?? []) {
        // Match del titular por los últimos 10 dígitos del teléfono (limit 1: dos titulares con
        // teléfonos parecidos no deben tumbar el insert).
        const from = digits(m.from)
        const { data: ownerRows } = await admin
          .from("owners")
          .select("id")
          .eq("clinic_id", clinicId)
          .ilike("phone", `%${from.slice(-10)}%`)
          .limit(1)
        const ownerId = (ownerRows as { id: string }[] | null)?.[0]?.id ?? null
        const { data: upserted, error } = await admin
          .from("whatsapp_messages")
          .upsert(
            {
              clinic_id: clinicId,
              owner_id: ownerId,
              wa_message_id: m.id,
              wa_phone_from: m.from,
              wa_phone_to: value.metadata?.display_phone_number ?? "",
              direction: "inbound",
              body: m.text?.body ?? null,
              media_type: m.type && m.type !== "text" ? m.type : null,
            },
            { onConflict: "wa_message_id", ignoreDuplicates: true },
          )
          .select("id")
        if (error) console.error("whatsapp/webhook upsert:", error.message)
        else {
          const isNew = (upserted ?? []).length > 0
          inserted += isNew ? 1 : 0 // los duplicados ignorados no cuentan
          // Se dispara DESPUÉS de responder el webhook (after), solo para entrantes nuevos:
          // primero cartera (intents de cobranza), luego el modo auto general — con todas sus
          // salvaguardas (opt-in, debounce, idempotencia, límites, "nada clínico").
          if (isNew) {
            after(() =>
              routeInbound({
                clinicId,
                waMessageId: m.id,
                fromPhone: m.from,
                text: m.text?.body ?? null,
              }),
            )
          }
        }
      }

      // Estados de entrega/lectura/fallo de mensajes salientes
      for (const s of value.statuses ?? []) {
        const tsNum = Number(s.timestamp)
        const ts = Number.isFinite(tsNum) && tsNum > 0 ? new Date(tsNum * 1000).toISOString() : new Date().toISOString()
        const patch =
          s.status === "read"
            ? { read_at: ts, delivered_at: ts }
            : s.status === "delivered"
              ? { delivered_at: ts }
              : s.status === "failed"
                ? {
                    failed_at: ts,
                    error_detail: s.errors?.[0]?.title ?? s.errors?.[0]?.message ?? "Fallo reportado por WhatsApp",
                  }
                : null
        if (!patch) continue
        const { error } = await admin
          .from("whatsapp_messages")
          .update(patch)
          .eq("wa_message_id", s.id)
          .eq("clinic_id", clinicId) // nunca cruzar tenants con service_role
        if (!error) updated += 1
      }
    }
  }

  return NextResponse.json({ ok: true, inserted, updated })
}

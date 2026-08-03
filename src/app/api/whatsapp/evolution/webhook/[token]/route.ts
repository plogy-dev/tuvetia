import { NextResponse, after } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { verifySharedSecret } from "@/lib/whatsapp/verify"
import { getOwnerPhone } from "@/lib/whatsapp/evolution"
import { capturarMediaEvolution } from "@/lib/whatsapp/media"
import { horaDelProveedor } from "@/lib/whatsapp/hora-del-proveedor"
import {
  esConversacionIndividual,
  textoDeMensaje,
  tipoDeMedia,
  tiposDeContenido,
  type EvoMessage,
} from "@/lib/whatsapp/baileys-mensaje"
import { routeInbound } from "@/lib/whatsapp/inbound-router"

export const runtime = "nodejs"
export const maxDuration = 60 // after(): debounce del modo auto

// Webhook de Evolution API (Baileys). Evolution NO firma sus webhooks: la auth es el segmento
// [token] de la URL (solo Evolution la conoce — la registramos nosotros) comparado en tiempo
// constante, + la instancia debe existir en whatsapp_integrations.
//
// Normaliza los eventos de Baileys a nuestro esquema whatsapp_messages (Meta-nativo):
//  - messages.upsert: entrantes Y salientes (fromMe=true = lo que el vet escribe desde su teléfono
//    → sync completo del número, sin coexistencia de Meta). Grupos y broadcasts se IGNORAN siempre
//    (protección: el agente jamás toca grupos).
//  - connection.update: open → connected · close → disconnected (aviso en Configuración).

type EvoPayload = {
  event?: string
  instance?: string
  data?: EvoMessage | EvoMessage[] | { state?: string; connection?: string }
}

const digits = (s: string) => s.replace(/\D/g, "")

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const secret = process.env.EVOLUTION_WEBHOOK_TOKEN
  if (!secret) return new Response("Webhook no configurado", { status: 503 })
  if (!verifySharedSecret(token, secret)) return new Response("Unauthorized", { status: 401 })

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return new Response("Falta SUPABASE_SERVICE_ROLE_KEY", { status: 503 })
  }

  const payload = (await req.json().catch(() => null)) as EvoPayload | null
  const event = payload?.event?.toLowerCase()
  const instance = payload?.instance
  if (!payload || !event || !instance) return NextResponse.json({ ok: true, ignored: true })

  // Una línea por evento recibido. Es la única forma de distinguir "Evolution no nos manda
  // messages.upsert" de "nos lo manda y lo estamos tirando", que desde la base se ven idénticos
  // (cero mensajes en las dos). Sin contenido: sólo el nombre del evento y la instancia.
  console.info(`evolution/webhook: evento=${event} instancia=${instance}`)

  const { data: integRow } = await admin
    .from("whatsapp_integrations")
    .select("clinic_id, phone_number, status")
    .eq("evolution_instance", instance)
    .maybeSingle()
  const integ = integRow as { clinic_id: string; phone_number: string | null; status: string } | null
  if (!integ) {
    console.warn(`evolution/webhook: instancia "${instance}" sin integración en la base`)
    return NextResponse.json({ ok: true, ignored: true })
  }
  const clinicId = integ.clinic_id

  if (event === "connection.update") {
    const d = payload.data as { state?: string; connection?: string } | undefined
    const state = d?.state ?? d?.connection
    if (state === "open") {
      const phone = integ.phone_number ?? (await getOwnerPhone(instance))
      await admin
        .from("whatsapp_integrations")
        .update({
          status: "connected",
          ...(phone ? { phone_number: phone } : {}),
          ...(integ.status !== "connected" ? { connected_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("clinic_id", clinicId)
    } else if (state === "close" && integ.status === "connected") {
      await admin
        .from("whatsapp_integrations")
        .update({ status: "disconnected", updated_at: new Date().toISOString() })
        .eq("clinic_id", clinicId)
    }
    return NextResponse.json({ ok: true })
  }

  if (event === "messages.upsert") {
    const raw = payload.data
    const list = (Array.isArray(raw) ? raw : [raw]) as EvoMessage[]
    let inserted = 0
    for (const m of list) {
      const jid = m.key?.remoteJid ?? ""
      const waMessageId = m.key?.id
      if (!waMessageId || !esConversacionIndividual(jid)) {
        // NUNCA descartar en silencio. Un webhook que se conecta bien y no guarda nada es
        // indistinguible de uno que no recibe nada, y sin esta línea no hay forma de saber cuál de
        // los dos es. Se loguea el JID (no es dato clínico) y jamás el contenido.
        console.warn(`evolution/webhook: descartado por jid "${jid}" (id=${waMessageId ?? "sin-id"})`)
        continue
      }
      const contactPhone = jid.split("@")[0]
      const fromMe = Boolean(m.key?.fromMe)
      const body = textoDeMensaje(m)
      const media = tipoDeMedia(m)
      if (!body && !media) {
        // Lo mismo: acá caen los tipos que todavía no sabemos leer. Se loguean las CLAVES del
        // objeto —no los valores— que es justo lo que hace falta para agregar el que falte.
        const claves = tiposDeContenido(m)
        console.warn(`evolution/webhook: sin texto ni media, tipos=[${claves}] (id=${waMessageId})`)
        continue
      }

      const { data: ownerRows } = await admin
        .from("owners")
        .select("id")
        .eq("clinic_id", clinicId)
        .ilike("phone", `%${digits(contactPhone).slice(-10)}%`)
        .limit(1)
      const ownerId = (ownerRows as { id: string }[] | null)?.[0]?.id ?? null

      const { data: upserted, error } = await admin
        .from("whatsapp_messages")
        .upsert(
          {
            clinic_id: clinicId,
            owner_id: ownerId,
            wa_message_id: waMessageId,
            wa_phone_from: fromMe ? (integ.phone_number ?? "") : contactPhone,
            wa_phone_to: fromMe ? contactPhone : (integ.phone_number ?? ""),
            direction: fromMe ? "outbound" : "inbound",
            body,
            media_type: media,
            // `?? undefined` y no `?? null`: la columna es not null con default now(), así que
            // omitirla es lo que deja entrar la hora de llegada como respaldo.
            provider_timestamp: horaDelProveedor(m.messageTimestamp) ?? undefined,
          },
          { onConflict: "wa_message_id", ignoreDuplicates: true },
        )
        .select("id")
      if (error) {
        console.error("evolution/webhook upsert:", error.message)
        continue
      }
      const isNew = (upserted ?? []).length > 0
      if (isNew) inserted += 1
      if (!isNew) continue

      // Los bytes se bajan FUERA de la respuesta del webhook: son megas y Evolution reintenta si
      // tardamos. Va también para los salientes (fromMe): la foto que el vet manda desde su propio
      // teléfono tiene que verse en la bandeja igual que la que manda el titular.
      const bajarMedia = media
        ? () => capturarMediaEvolution(admin, { clinicId, instancia: instance, waMessageId, mensajeCrudo: m })
        : null

      if (fromMe) {
        if (bajarMedia) after(bajarMedia)
        continue
      }

      // Entrantes: primero cartera (intents de cobranza), luego modo auto (inbound-router).
      //
      // La media se baja ANTES y en el MISMO `after`, no en uno aparte, porque cartera lee
      // `media_url` para reconocer un comprobante de pago (`lib/cartera/wa-router.ts`). En dos
      // `after` separados eso es una carrera, y la que pierde es la del titular que mandó la foto
      // del pago y no recibe respuesta.
      after(async () => {
        if (bajarMedia) await bajarMedia()
        await routeInbound({ clinicId, waMessageId, fromPhone: contactPhone, text: body })
      })
    }
    return NextResponse.json({ ok: true, inserted })
  }

  return NextResponse.json({ ok: true, ignored: true })
}

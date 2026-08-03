// Envío de WhatsApp + registro del saliente — el ÚNICO camino de salida de mensajes.
// Lo usan: /api/whatsapp/send (bandeja), la ejecución de acciones de Athos (aprobadas por el vet)
// y el modo auto. SOLO servidor (usa service_role).

import { createAdminClient } from "@/lib/supabase/admin"
import { ErrorQueElVetPuedeResolver } from "./error-de-envio"
import { providerFor, type WhatsAppIntegrationRow } from "./provider"

export type SendWhatsAppOptions = {
  ownerId?: string | null
  sentBy?: string | null // null en modo auto (lo envió Athos, no un humano)
  agentMode?: "auto" | "review" | "paused" | "intervene"
}

export type SendWhatsAppResult = {
  waMessageId: string
  message: { id: string; created_at: string } | null // null si el registro en BD falló (el mensaje SÍ salió)
}

const INTEGRATION_COLUMNS =
  "clinic_id, provider, status, phone_number, kapso_customer_id, kapso_phone_number_id, waba_id, meta_phone_number_id, access_token_enc, token_expires_at, evolution_instance"

export async function loadIntegration(clinicId: string): Promise<WhatsAppIntegrationRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("whatsapp_integrations")
    .select(INTEGRATION_COLUMNS)
    .eq("clinic_id", clinicId)
    .maybeSingle()
  return (data as WhatsAppIntegrationRow | null) ?? null
}

export async function sendWhatsAppText(
  clinicId: string,
  to: string,
  body: string,
  opts: SendWhatsAppOptions = {},
): Promise<SendWhatsAppResult> {
  const admin = createAdminClient()
  const integ = await loadIntegration(clinicId)
  if (!integ || integ.status !== "connected") {
    throw new Error("WhatsApp no está conectado. Verificá la conexión en Configuración → WhatsApp.")
  }

  const destino = to.replace(/\D/g, "")

  // Mandarse un mensaje al propio número de la clínica no funciona y NUNCA va a funcionar: el chat
  // "mensajes contigo" de WhatsApp es un caso especial y no se direcciona como un contacto normal
  // por la API. El proveedor devuelve un 400 seco, que traducido a la UI queda como "revisá que el
  // número esté bien" — un consejo inútil, porque el número está perfecto.
  //
  // No es rebuscado: es lo primero que hace cualquiera para probar, y basta con que el vet se cargue
  // a sí mismo como titular para que le pase sin darse cuenta. Medido en vivo el 2026-08-03.
  const propio = (integ.phone_number ?? "").replace(/\D/g, "")
  if (propio && destino === propio) {
    throw new ErrorQueElVetPuedeResolver(
      "No se puede enviar un WhatsApp al número de la propia clínica. Para probar, usá otro teléfono.",
      400,
    )
  }

  const { waMessageId } = await providerFor(integ).sendText(integ, destino, body)

  // Registrar el saliente y devolver la fila real (id + created_at de la BD) — el front la usa
  // para no duplicar el hilo. Un retry único: si falla dos veces, el mensaje salió pero no quedó
  // registrado, y el caller decide cómo avisarlo.
  const row = {
    clinic_id: clinicId,
    owner_id: opts.ownerId ?? null,
    wa_message_id: waMessageId,
    wa_phone_from: integ.phone_number ?? "",
    wa_phone_to: to,
    direction: "outbound" as const,
    body,
    sent_by: opts.sentBy ?? null,
    ...(opts.agentMode ? { agent_mode: opts.agentMode } : {}),
  }
  // `provider_timestamp` se devuelve porque es la clave con la que la bandeja ORDENA el hilo: sin
  // ella la fila recién enviada entra al estado sin criterio de orden y se va al principio.
  // Para un saliente propio no hace falta escribirla — el default `now()` es la hora de envío, que
  // aquí ES la del proveedor.
  let message: { id: string; created_at: string; provider_timestamp: string } | null = null
  for (let attempt = 1; attempt <= 2 && !message; attempt += 1) {
    const { data, error } = await admin
      .from("whatsapp_messages")
      .insert(row)
      .select("id, created_at, provider_timestamp")
      .single()
    if (!error) message = data as { id: string; created_at: string; provider_timestamp: string }
    else if (attempt === 2) console.error("No se pudo registrar el mensaje saliente:", error)
  }
  return { waMessageId, message }
}

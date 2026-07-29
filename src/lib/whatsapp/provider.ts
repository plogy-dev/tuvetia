// Capa proveedor-agnóstica de WhatsApp — SOLO servidor.
// El transporte (Kapso hoy, Meta Cloud API directa como objetivo) se elige por tenant vía la
// columna whatsapp_integrations.provider; el resto del sistema (bandeja, webhook parser, Athos,
// export, admin) habla el formato de Meta y no sabe cuál transporte hay debajo.
// Rollout clínica-por-clínica: las conectadas siguen en 'kapso'; las nuevas pueden ir a 'meta'.

export type WhatsAppProviderName = "kapso" | "meta" | "evolution"

export type WhatsAppIntegrationRow = {
  clinic_id: string
  provider: WhatsAppProviderName
  status: "pending" | "connected" | "disconnected"
  phone_number: string | null
  kapso_customer_id: string | null
  kapso_phone_number_id: string | null // phone_number_id de META (nombre histórico de la columna)
  waba_id: string | null
  meta_phone_number_id: string | null
  access_token_enc: string | null // AES-256-GCM; columna revocada para PostgREST
  token_expires_at: string | null
  evolution_instance: string | null // instancia Baileys (1 por clínica) en Evolution API
}

export type RefreshedStatus = {
  status: "pending" | "connected" | "disconnected"
  phoneNumber: string | null
  phoneNumberId: string | null
  reason?: string
}

export interface WhatsAppProvider {
  readonly name: WhatsAppProviderName
  sendText(integ: WhatsAppIntegrationRow, to: string, body: string): Promise<{ waMessageId: string }>
  refreshStatus(integ: WhatsAppIntegrationRow): Promise<RefreshedStatus>
}

import { kapsoProvider } from "./kapso-provider"
import { metaProvider } from "./meta-provider"
import { evolutionProvider } from "./evolution-provider"

export function providerFor(integ: Pick<WhatsAppIntegrationRow, "provider">): WhatsAppProvider {
  if (integ.provider === "meta") return metaProvider
  if (integ.provider === "evolution") return evolutionProvider
  return kapsoProvider
}

// phone_number_id efectivo de un tenant (para rutear webhooks de la Cloud API; Evolution rutea
// por nombre de instancia, no por phone_number_id).
export function phoneNumberIdOf(integ: WhatsAppIntegrationRow): string | null {
  return integ.provider === "meta" ? integ.meta_phone_number_id : integ.kapso_phone_number_id
}

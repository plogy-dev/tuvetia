// Adaptador Meta Cloud API directa (Tech Provider) de la interfaz WhatsAppProvider.
// Mismo body/formato que ya usa el resto del sistema (el esquema siempre fue Meta-nativo);
// cambia el host (graph.facebook.com) y la auth (business token del tenant, cifrado at-rest).
// El onboarding es Embedded Signup (popup del SDK de FB DENTRO de tuvetia — sin redirects):
// ver /api/whatsapp/exchange.

import { decryptToken } from "./crypto"
import type { RefreshedStatus, WhatsAppIntegrationRow, WhatsAppProvider } from "./provider"

const GRAPH_BASE = "https://graph.facebook.com/v23.0"
const TIMEOUT_MS = 15_000

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "MetaApiError"
  }
}

async function graph<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new MetaApiError(`Meta ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`, res.status)
  }
  return (await res.json()) as T
}

function tokenOf(integ: WhatsAppIntegrationRow): string {
  if (!integ.access_token_enc) throw new Error("La clínica no tiene token de Meta guardado")
  return decryptToken(integ.access_token_enc)
}

type MetaPhoneNumber = {
  id: string
  display_phone_number?: string
  verified_name?: string
  platform_type?: string
}

export const metaProvider: WhatsAppProvider = {
  name: "meta",

  async sendText(integ: WhatsAppIntegrationRow, to: string, body: string) {
    if (!integ.meta_phone_number_id) throw new Error("La clínica no tiene número conectado en Meta")
    const json = await graph<{ messages?: { id: string }[] }>(
      `/${encodeURIComponent(integ.meta_phone_number_id)}/messages`,
      tokenOf(integ),
      {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body },
        }),
      },
    )
    const waMessageId = json.messages?.[0]?.id
    if (!waMessageId) throw new Error("Meta no devolvió el id del mensaje")
    return { waMessageId }
  },

  async refreshStatus(integ: WhatsAppIntegrationRow): Promise<RefreshedStatus> {
    if (!integ.waba_id) return { status: "pending", phoneNumber: null, phoneNumberId: null }
    const json = await graph<{ data?: MetaPhoneNumber[] }>(
      `/${encodeURIComponent(integ.waba_id)}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type`,
      tokenOf(integ),
    )
    const mine =
      json.data?.find((n) => n.id === integ.meta_phone_number_id) ?? json.data?.[0] ?? null
    if (!mine) {
      return integ.status === "connected"
        ? { status: "disconnected", phoneNumber: null, phoneNumberId: null, reason: "numero_desvinculado" }
        : { status: "pending", phoneNumber: null, phoneNumberId: null, reason: "sin_numero_todavia" }
    }
    return {
      status: "connected",
      phoneNumber: mine.display_phone_number ?? null,
      phoneNumberId: mine.id,
    }
  },
}

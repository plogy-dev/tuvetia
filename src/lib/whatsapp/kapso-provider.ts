// Adaptador Kapso de la interfaz WhatsAppProvider. Envuelve el cliente REST existente
// (src/lib/kapso.ts) — este archivo muere completo cuando el último tenant migre a Meta directo.

import { listCustomerPhoneNumbers, sendTextMessage } from "@/lib/kapso"
import type { RefreshedStatus, WhatsAppIntegrationRow, WhatsAppProvider } from "./provider"

export const kapsoProvider: WhatsAppProvider = {
  name: "kapso",

  async sendText(integ: WhatsAppIntegrationRow, to: string, body: string) {
    if (!integ.kapso_phone_number_id) throw new Error("La clínica no tiene número conectado en Kapso")
    const waMessageId = await sendTextMessage(integ.kapso_phone_number_id, to, body)
    return { waMessageId }
  },

  async refreshStatus(integ: WhatsAppIntegrationRow): Promise<RefreshedStatus> {
    if (!integ.kapso_customer_id) return { status: "pending", phoneNumber: null, phoneNumberId: null }
    const numbers = await listCustomerPhoneNumbers(integ.kapso_customer_id)
    const mine = numbers[0]
    if (!mine) {
      return integ.status === "connected"
        ? { status: "disconnected", phoneNumber: null, phoneNumberId: null, reason: "numero_desvinculado" }
        : { status: "pending", phoneNumber: null, phoneNumberId: null, reason: "sin_numero_todavia" }
    }
    return {
      status: "connected",
      phoneNumber: mine.display_phone_number ?? mine.display_phone_number_normalized ?? null,
      // Para el proxy Meta de Kapso se necesita el phone_number_id de META, no el id de Kapso.
      phoneNumberId: mine.phone_number_id ?? mine.id,
    }
  },
}

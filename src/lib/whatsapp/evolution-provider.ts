// Adaptador Evolution (Baileys, NO oficial) de la interfaz WhatsAppProvider.
//
// Protecciones de comportamiento (el riesgo de baneo se minimiza actuando como un humano):
//  - Presencia "escribiendo…" + delay aleatorio 1.2–3.5 s antes de cada envío.
//  - Nunca grupos ni broadcasts (se filtran en el webhook).
//  - El volumen lo frenan las capas de arriba: inbound-first, límite diario con warm-up y
//    anti-loop en auto-reply.ts; aprobación humana para todo lo demás.

import { getConnectionState, getOwnerPhone, sendComposing, sendText as evoSendText } from "./evolution"
import type { RefreshedStatus, WhatsAppIntegrationRow, WhatsAppProvider } from "./provider"

function humanDelayMs(text: string): number {
  // ~40 ms por caracter (tipeo humano rápido), acotado a 1.2–3.5 s, con jitter.
  const typing = Math.min(3500, Math.max(1200, text.length * 40))
  return Math.round(typing * (0.8 + Math.random() * 0.4))
}

export const evolutionProvider: WhatsAppProvider = {
  name: "evolution",

  async sendText(integ: WhatsAppIntegrationRow, to: string, body: string) {
    if (!integ.evolution_instance) throw new Error("La clínica no tiene instancia de Evolution")
    const delay = humanDelayMs(body)
    await sendComposing(integ.evolution_instance, to, delay)
    const waMessageId = await evoSendText(integ.evolution_instance, to, body, delay)
    return { waMessageId }
  },

  async refreshStatus(integ: WhatsAppIntegrationRow): Promise<RefreshedStatus> {
    if (!integ.evolution_instance) return { status: "pending", phoneNumber: null, phoneNumberId: null }
    const state = await getConnectionState(integ.evolution_instance)
    if (state === "open") {
      const phone = integ.phone_number ?? (await getOwnerPhone(integ.evolution_instance))
      return { status: "connected", phoneNumber: phone, phoneNumberId: null }
    }
    if (state === "close") {
      return integ.status === "connected"
        ? { status: "disconnected", phoneNumber: null, phoneNumberId: null, reason: "numero_desvinculado" }
        : { status: "pending", phoneNumber: null, phoneNumberId: null, reason: "sin_numero_todavia" }
    }
    return { status: "pending", phoneNumber: null, phoneNumberId: null, reason: "sin_numero_todavia" }
  },
}

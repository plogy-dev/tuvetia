// Router de entrantes de WhatsApp — SOLO servidor, invocado por los webhooks vía after().
// Orden: (1) cartera — si el mensaje responde a una cobranza activa, el agente de cartera lo
// maneja con su catálogo CERRADO de intents (idempotente por comm_messages, respeta takeover);
// (2) si cartera no lo reclama, cae al modo auto general (clasificador "nada clínico jamás",
// debounce, límites, warm-up). Ninguna de las dos ramas puede romper el webhook.

import { applyCarteraInbound } from "@/lib/cartera/wa-router"
import { maybeAutoReply } from "./auto-reply"

export async function routeInbound(input: {
  clinicId: string
  waMessageId: string
  fromPhone: string
  text: string | null
}): Promise<void> {
  try {
    const { handled } = await applyCarteraInbound(
      input.clinicId,
      input.fromPhone,
      input.text ?? "",
      input.waMessageId,
    )
    if (handled) return
  } catch (e) {
    console.error("whatsapp/inbound-router cartera:", e)
  }
  await maybeAutoReply(input)
}

// Router de entrantes de WhatsApp — SOLO servidor, invocado por los webhooks vía after().
// Hoy solo despacha al modo auto general (clasificador "nada clínico jamás", debounce, límites,
// warm-up). Existe como punto único de entrada para que los webhooks no tengan que saber qué
// consumidores hay: el motor de cartera se engancha acá cuando entre, delante del modo auto.
// Ninguna rama puede romper el webhook.

import { maybeAutoReply } from "./auto-reply"

export async function routeInbound(input: {
  clinicId: string
  waMessageId: string
  fromPhone: string
  text: string | null
}): Promise<void> {
  await maybeAutoReply(input)
}

// Cliente de la Platform API de Kapso (WhatsApp multi-tenant) — SOLO servidor.
// Cada clínica = un "customer" de Kapso; el vet conecta su número con un setup link hosteado
// (QR / coexistence con la app WhatsApp Business, o número dedicado). REST puro, sin dependencias.
//
// Config del servidor (Vercel): KAPSO_API_KEY (obligatoria), KAPSO_WEBHOOK_SECRET (webhook).
// Sin la key, las funciones fallan con mensaje claro y la UI muestra "no configurado" —
// mismo patrón de degradación que google-calendar.ts.
//
// Paths verificados contra docs.kapso.ai (2026-07): los listados aceptan filtros server-side
// (?external_customer_id= en /customers, ?customer_id= en /whatsapp/phone_numbers) y paginan
// con page/per_page — nunca traer el proyecto entero y filtrar en memoria.

const KAPSO_BASE = "https://api.kapso.ai/platform/v1"
const KAPSO_TIMEOUT_MS = 15_000

// Error con el status HTTP como dato estructurado (no string-matching sobre el mensaje).
export class KapsoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "KapsoError"
  }
}

function apiKey(): string {
  const key = process.env.KAPSO_API_KEY
  if (!key) throw new Error("Falta KAPSO_API_KEY en el servidor (integración WhatsApp no configurada)")
  return key
}

async function kapso<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET"
  const attempts = method === "GET" ? 2 : 1 // un retry único para GETs (fallos transitorios)
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(`${KAPSO_BASE}${path}`, {
        ...init,
        headers: {
          "X-API-Key": apiKey(),
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(KAPSO_TIMEOUT_MS),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        const err = new KapsoError(`Kapso ${method} ${path} → ${res.status}: ${body.slice(0, 200)}`, res.status)
        if (res.status >= 500 && attempt < attempts) {
          lastError = err
          continue
        }
        throw err
      }
      return (await res.json()) as T
    } catch (e) {
      if (e instanceof KapsoError) throw e
      // Red caída / timeout: reintentar solo GETs
      lastError = e
      if (attempt >= attempts) throw e
    }
  }
  throw lastError
}

type KapsoCustomer = { id: string; external_customer_id?: string | null }

// Busca el customer de Kapso por nuestro tenant id, con filtro server-side (no pagina en memoria).
async function findKapsoCustomer(clinicId: string): Promise<string | null> {
  const json = await kapso<{ data: KapsoCustomer[] }>(
    `/customers?external_customer_id=${encodeURIComponent(clinicId)}&per_page=1`,
  )
  return json.data?.[0]?.id ?? null
}

// Crea (o RECUPERA) el customer de Kapso para una clínica. external_customer_id = clinic_id.
// Idempotente: si un intento anterior lo creó pero no llegó a persistirse en nuestra BD, Kapso
// responde 422 "External customer has already been taken" -> lo buscamos y reutilizamos.
export async function createKapsoCustomer(clinicId: string, clinicName: string): Promise<string> {
  try {
    const json = await kapso<{ data: { id: string } }>("/customers", {
      method: "POST",
      body: JSON.stringify({ customer: { name: clinicName, external_customer_id: clinicId } }),
    })
    return json.data.id
  } catch (e) {
    if (e instanceof KapsoError && e.status === 422) {
      const existing = await findKapsoCustomer(clinicId)
      if (existing) return existing
    }
    throw e
  }
}

// Genera el setup link hosteado donde el vet conecta su WhatsApp (ahí vive el QR de coexistence).
export async function createSetupLink(
  kapsoCustomerId: string,
  successRedirectUrl: string,
): Promise<string> {
  const json = await kapso<{ data: { url: string } }>(
    `/customers/${encodeURIComponent(kapsoCustomerId)}/setup_links`,
    {
      method: "POST",
      body: JSON.stringify({
        setup_link: {
          success_redirect_url: successRedirectUrl,
          allowed_connection_types: ["coexistence", "dedicated"],
          language: "es",
        },
      }),
    },
  )
  return json.data.url
}

export type KapsoPhoneNumber = {
  id: string
  phone_number_id?: string | null // el ID de Meta — es el que usa el proxy de envío
  display_phone_number?: string | null
  display_phone_number_normalized?: string | null
  status?: string | null
  customer_id?: string | null
}

// Números del customer de ESTA clínica (filtro server-side; nunca el listado global del proyecto).
export async function listCustomerPhoneNumbers(kapsoCustomerId: string): Promise<KapsoPhoneNumber[]> {
  const json = await kapso<{ data: KapsoPhoneNumber[] }>(
    `/whatsapp/phone_numbers?customer_id=${encodeURIComponent(kapsoCustomerId)}&per_page=50`,
  )
  return json.data ?? []
}

// Envía un mensaje de texto por el número de la clínica. Kapso proxya la Cloud API de Meta:
// POST https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages (X-API-Key, body Meta
// estándar). phone_number_id es el ID de Meta (columna kapso_phone_number_id). Devuelve el
// wa_message_id (messages[0].id) para registrar el saliente y que el webhook lo actualice.
const KAPSO_META_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0"

export async function sendTextMessage(
  phoneNumberId: string,
  to: string,
  body: string,
): Promise<string> {
  const res = await fetch(`${KAPSO_META_BASE}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { "X-API-Key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body },
    }),
    signal: AbortSignal.timeout(KAPSO_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new KapsoError(`Kapso send → ${res.status}: ${text.slice(0, 200)}`, res.status)
  }
  const json = (await res.json()) as { messages?: { id: string }[] }
  const id = json.messages?.[0]?.id
  if (!id) throw new Error("Kapso no devolvió el id del mensaje")
  return id
}

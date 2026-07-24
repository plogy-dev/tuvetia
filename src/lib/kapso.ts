// Cliente de la Platform API de Kapso (WhatsApp multi-tenant) — SOLO servidor.
// Cada clínica = un "customer" de Kapso; el vet conecta su número con un setup link hosteado
// (QR / coexistence con la app WhatsApp Business, o número dedicado). REST puro, sin dependencias.
//
// Config del servidor (Vercel): KAPSO_API_KEY (obligatoria), KAPSO_WEBHOOK_SECRET (webhook).
// Sin la key, las funciones fallan con mensaje claro y la UI muestra "no configurado" —
// mismo patrón de degradación que google-calendar.ts.

const KAPSO_BASE = "https://api.kapso.ai/platform/v1"

function apiKey(): string {
  const key = process.env.KAPSO_API_KEY
  if (!key) throw new Error("Falta KAPSO_API_KEY en el servidor (integración WhatsApp no configurada)")
  return key
}

async function kapso<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${KAPSO_BASE}${path}`, {
    ...init,
    headers: {
      "X-API-Key": apiKey(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Kapso ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

// Crea el customer de Kapso para una clínica. external_customer_id = clinic_id (nuestro tenant).
export async function createKapsoCustomer(clinicId: string, clinicName: string): Promise<string> {
  const json = await kapso<{ data: { id: string } }>("/customers", {
    method: "POST",
    body: JSON.stringify({ customer: { name: clinicName, external_customer_id: clinicId } }),
  })
  return json.data.id
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

type KapsoPhoneNumber = {
  id: string
  phone_number?: string
  display_phone_number?: string
  status?: string
  customer_id?: string
}

// Números del proyecto (para verificar conexión). Se filtra por customer del lado nuestro:
// el shape exacto por-customer puede variar — confirmar contra el OpenAPI de Kapso (ver WHATSAPP.md).
export async function listPhoneNumbers(): Promise<KapsoPhoneNumber[]> {
  const json = await kapso<{ data: KapsoPhoneNumber[] }>("/phone-numbers")
  return json.data ?? []
}

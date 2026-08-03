// Cliente REST de Evolution API (Baileys self-hosted) — SOLO servidor.
// Evolution corre como servicio persistente (Railway/VPS, ver docs/EVOLUTION.md): mantiene la
// sesión WebSocket de WhatsApp Web de cada clínica (1 instancia = 1 número) y nos reenvía eventos
// por webhook. ADVERTENCIA: protocolo NO oficial (ToS de WhatsApp) — las protecciones de
// comportamiento viven en evolution-provider.ts y auto-reply.ts; el consentimiento en la conexión.
//
// Envs: EVOLUTION_BASE_URL, EVOLUTION_API_KEY (global), EVOLUTION_WEBHOOK_TOKEN (segmento secreto
// de la URL del webhook que registramos — Evolution no firma sus webhooks).

const TIMEOUT_MS = 20_000

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "EvolutionError"
  }
}

function baseUrl(): string {
  const url = process.env.EVOLUTION_BASE_URL
  if (!url) throw new Error("Falta EVOLUTION_BASE_URL en el servidor")
  return url.replace(/\/$/, "")
}

function apiKey(): string {
  const key = process.env.EVOLUTION_API_KEY
  if (!key) throw new Error("Falta EVOLUTION_API_KEY en el servidor")
  return key
}

async function evo<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { apikey: apiKey(), "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new EvolutionError(`Evolution ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`, res.status)
  }
  return (await res.json().catch(() => ({}))) as T
}

export const EVOLUTION_WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"] as const

export function webhookUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL
  const token = process.env.EVOLUTION_WEBHOOK_TOKEN
  if (!site || !token) throw new Error("Faltan NEXT_PUBLIC_SITE_URL o EVOLUTION_WEBHOOK_TOKEN")
  return `${site.replace(/\/$/, "")}/api/whatsapp/evolution/webhook/${token}`
}

// Crea (o reusa) la instancia de la clínica. Idempotente: si ya existe, no es error.
export async function ensureInstance(instanceName: string): Promise<void> {
  try {
    await evo("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        webhook: { url: webhookUrl(), byEvents: false, base64: false, events: EVOLUTION_WEBHOOK_EVENTS },
      }),
    })
  } catch (e) {
    // "already in use" → reusar. Cualquier otro error sí es fallo real.
    if (!(e instanceof EvolutionError && (e.status === 403 || /already|in use|exists/i.test(e.message)))) throw e
  }
  // Belt-and-braces: fijar el webhook aunque la instancia ya existiera (el shape del create varía
  // entre versiones de Evolution; /webhook/set es estable).
  try {
    await evo(`/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        webhook: { enabled: true, url: webhookUrl(), webhookByEvents: false, events: EVOLUTION_WEBHOOK_EVENTS },
      }),
    })
  } catch (e) {
    console.warn("evolution webhook/set:", (e as Error).message)
  }
}

// QR para vincular (data URL base64). Si la instancia ya está conectada, Evolution no devuelve QR.
export async function getConnectQr(instanceName: string): Promise<{ qr: string | null; state: string | null }> {
  const json = await evo<{ base64?: string; code?: string; instance?: { state?: string } }>(
    `/instance/connect/${encodeURIComponent(instanceName)}`,
  )
  const qr = json.base64 ? (json.base64.startsWith("data:") ? json.base64 : `data:image/png;base64,${json.base64}`) : null
  return { qr, state: json.instance?.state ?? null }
}

export async function getConnectionState(instanceName: string): Promise<"open" | "connecting" | "close" | "unknown"> {
  const json = await evo<{ instance?: { state?: string } }>(
    `/instance/connectionState/${encodeURIComponent(instanceName)}`,
  )
  const s = json.instance?.state
  return s === "open" || s === "connecting" || s === "close" ? s : "unknown"
}

// Número del dueño de la instancia (para whatsapp_integrations.phone_number).
export async function getOwnerPhone(instanceName: string): Promise<string | null> {
  try {
    const json = await evo<unknown>(`/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`)
    const list = Array.isArray(json) ? json : [json]
    for (const item of list as Record<string, unknown>[]) {
      const inst = (item?.instance ?? item) as Record<string, unknown>
      const owner = (inst?.owner ?? inst?.ownerJid ?? inst?.number) as string | undefined
      if (owner) return owner.split("@")[0]
    }
  } catch {
    // no bloquea: el número también llega por connection.update
  }
  return null
}

// Presencia "escribiendo…" — parte de la cadencia humana. Best-effort.
//
// TIMEOUT CORTO Y PROPIO. Con los 20 s de todo lo demás, un Evolution inalcanzable hacía que el vet
// esperara CUARENTA segundos por un fallo: veinte acá y veinte en el envío de verdad. Medido en vivo
// el 2026-08-03. Y es la peor espera posible, porque este paso es decorativo: si la presencia no
// sale, el mensaje se manda igual. Cinco segundos alcanzan de sobra para algo que corre antes de un
// delay de tipeo de 1,2–3,5 s, y recortan a la mitad lo que tarda en fallar.
const TIMEOUT_PRESENCIA_MS = 5_000

export async function sendComposing(instanceName: string, number: string, delayMs: number): Promise<void> {
  try {
    await evo(
      `/chat/sendPresence/${encodeURIComponent(instanceName)}`,
      { method: "POST", body: JSON.stringify({ number, presence: "composing", delay: delayMs }) },
      TIMEOUT_PRESENCIA_MS,
    )
  } catch {
    // opcional por diseño
  }
}

export async function sendText(instanceName: string, number: string, text: string, delayMs: number): Promise<string> {
  const json = await evo<{ key?: { id?: string } }>(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({ number, text, delay: delayMs }),
  })
  const id = json.key?.id
  if (!id) throw new Error("Evolution no devolvió el id del mensaje")
  return id
}

// Bytes de una media entrante. Baileys no expone una URL descargable: el archivo viaja cifrado y
// sólo la sesión viva puede descifrarlo, así que Evolution lo devuelve en base64 por este endpoint.
// Hay que mandarle el mensaje CRUDO tal como llegó por el webhook (no basta el id): necesita las
// claves de cifrado que vienen dentro de `message`.
//
// Timeout propio y más largo que el del resto: acá viajan megas, no un JSON de control.
export async function getMediaBase64(
  instanceName: string,
  mensajeCrudo: unknown,
): Promise<{ base64: string; mimetype: string | null; fileName: string | null } | null> {
  const res = await fetch(`${baseUrl()}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    headers: { apikey: apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ message: mensajeCrudo, convertToMp4: false }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new EvolutionError(
      `Evolution POST /chat/getBase64FromMediaMessage → ${res.status}: ${body.slice(0, 300)}`,
      res.status,
    )
  }
  const json = (await res.json().catch(() => null)) as
    | { base64?: string; mimetype?: string; fileName?: string }
    | null
  if (!json?.base64) return null
  return { base64: json.base64, mimetype: json.mimetype ?? null, fileName: json.fileName ?? null }
}

export async function logoutInstance(instanceName: string): Promise<void> {
  await evo(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: "POST" })
}

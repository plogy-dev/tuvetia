// Verificación de webhooks de WhatsApp — SOLO servidor.
// Dos esquemas conviven durante la transición de proveedor:
//  - Meta Cloud API directa: firma HMAC-SHA256 del body crudo en X-Hub-Signature-256 ("sha256=<hex>").
//  - Kapso (legado): shared secret plano (header x-webhook-secret; query ?secret= deprecado).
// Todas las comparaciones son constant-time (los inputs se normalizan con SHA-256 antes de
// timingSafeEqual para no filtrar longitudes).

import { createHash, createHmac, timingSafeEqual } from "node:crypto"

function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest()
  const db = createHash("sha256").update(b, "utf8").digest()
  return timingSafeEqual(da, db)
}

// Firma oficial de Meta: HMAC-SHA256(appSecret, rawBody) == header "sha256=<hex>".
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")
  return safeEqual(header.slice("sha256=".length), expected)
}

// Shared secret plano (Kapso legado).
export function verifySharedSecret(provided: string | null, secret: string): boolean {
  if (!provided) return false
  return safeEqual(provided, secret)
}

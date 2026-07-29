// Cifrado app-level de tokens de WhatsApp (AES-256-GCM) — SOLO servidor.
// El business token de Meta de cada clínica se guarda cifrado en whatsapp_integrations
// .access_token_enc, columna además revocada para clientes PostgREST (doble protección; mejora el
// patrón de calendar_integrations 0007, que guarda el refresh_token en claro).
//
// Env: WHATSAPP_TOKEN_KEY = 32 bytes en base64 (openssl rand -base64 32).
// Formato en BD: "<ivB64>.<cipherB64>.<tagB64>".

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

function key(): Buffer {
  const raw = process.env.WHATSAPP_TOKEN_KEY
  if (!raw) throw new Error("Falta WHATSAPP_TOKEN_KEY en el servidor")
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) throw new Error("WHATSAPP_TOKEN_KEY debe ser 32 bytes en base64")
  return buf
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return `${iv.toString("base64")}.${enc.toString("base64")}.${cipher.getAuthTag().toString("base64")}`
}

export function decryptToken(enc: string): string {
  const [ivB64, cipherB64, tagB64] = enc.split(".")
  if (!ivB64 || !cipherB64 || !tagB64) throw new Error("Token cifrado con formato inválido")
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(cipherB64, "base64")), decipher.final()]).toString("utf8")
}

// Cifrado app-level de secretos de terceros que guardamos en la BD (AES-256-GCM) — SOLO servidor.
//
// Lo usan: los business token de Meta (whatsapp_integrations.access_token_enc) y las credenciales
// de correo por clínica (email_integrations.credential_enc). La columna además queda revocada para
// clientes PostREST: doble protección.
//
// Env: WHATSAPP_TOKEN_KEY = 32 bytes en base64 (openssl rand -base64 32).
//
// ⚠️ Sobre el nombre de la variable: quedó así porque el primer uso fue WhatsApp, y en producción YA
// hay tokens cifrados con esa llave. Renombrarla los volvería indescifrables, así que se conserva
// aunque hoy sea la llave de secretos de toda la app. Si algún día se rota, hay que re-cifrar lo
// existente en la misma operación.
//
// Formato en BD: "<ivB64>.<cipherB64>.<tagB64>".

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

function key(): Buffer {
  const raw = process.env.WHATSAPP_TOKEN_KEY
  if (!raw) throw new Error("Falta WHATSAPP_TOKEN_KEY en el servidor")
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) throw new Error("WHATSAPP_TOKEN_KEY debe ser 32 bytes en base64")
  return buf
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return `${iv.toString("base64")}.${enc.toString("base64")}.${cipher.getAuthTag().toString("base64")}`
}

export function decryptSecret(enc: string): string {
  const [ivB64, cipherB64, tagB64] = enc.split(".")
  if (!ivB64 || !cipherB64 || !tagB64) throw new Error("Secreto cifrado con formato inválido")
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(cipherB64, "base64")), decipher.final()]).toString("utf8")
}

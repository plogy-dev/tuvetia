#!/usr/bin/env node
/**
 * Crea (una sola vez) las 4 plantillas UTILITY de citas de WhatsApp y las deja pendientes de
 * aprobación de Meta (horas a días). Idioma `es` — Meta no tiene es_CO. Redactadas como
 * notificaciones transaccionales para pasar revisión como UTILITY (no MARKETING).
 *
 * Uso (proveedor según el tenant):
 *   node scripts/create-wa-templates.mjs --waba <WABA_ID>                    # Kapso (default)
 *   node scripts/create-wa-templates.mjs --waba <WABA_ID> --provider meta   # Meta directo
 *
 * Kapso: lee KAPSO_API_KEY de .env.local (espejo de Meta POST /{waba_id}/message_templates).
 * Meta:  lee META_ACCESS_TOKEN de .env.local (business token con whatsapp_business_management).
 */
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const dotenvPath = resolve(process.cwd(), ".env.local")
try {
  const raw = await readFile(dotenvPath, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    let value = m[2]
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1)
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value
  }
} catch {
  /* sin .env.local */
}

const args = process.argv.slice(2)
const waba = args.includes("--waba") ? args[args.indexOf("--waba") + 1] : null
const provider = args.includes("--provider") ? args[args.indexOf("--provider") + 1] : "kapso"

if (!waba) {
  console.error("Uso: node scripts/create-wa-templates.mjs --waba <WABA_ID> [--provider kapso|meta]")
  process.exit(1)
}

let url
let headers
if (provider === "meta") {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) {
    console.error("Falta META_ACCESS_TOKEN en .env.local (business token del WABA)")
    process.exit(1)
  }
  url = `https://graph.facebook.com/v23.0/${waba}/message_templates`
  headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
} else {
  const apiKey = process.env.KAPSO_API_KEY
  if (!apiKey) {
    console.error("Falta KAPSO_API_KEY en .env.local")
    process.exit(1)
  }
  const base = (process.env.KAPSO_API_BASE_URL ?? "https://api.kapso.ai").replace(/\/$/, "")
  url = `${base}/meta/whatsapp/v24.0/${waba}/message_templates`
  headers = { "X-API-Key": apiKey, "Content-Type": "application/json" }
}

// {{1}} dueño · {{2}} mascota · {{3}} fecha · {{4}} hora · {{5}} remitente
const EXAMPLE = [["Carolina", "Lola", "viernes 25 de julio", "3:00 p. m.", "Dra. Pérez"]]

const TEMPLATES = [
  {
    name: "tuvetia_cita_confirmacion",
    text: "Hola {{1}}, te confirmamos la cita de {{2}}: {{3}} a las {{4}}. Si necesitas reprogramar o cancelar, responde a este mensaje. — {{5}}",
  },
  {
    name: "tuvetia_cita_reprogramacion",
    text: "Hola {{1}}, la cita de {{2}} fue reprogramada. Nueva fecha: {{3}} a las {{4}}. Si no te queda bien, responde a este mensaje. — {{5}}",
  },
  {
    name: "tuvetia_cita_cancelacion",
    text: "Hola {{1}}, la cita de {{2}} programada para el {{3}} a las {{4}} fue cancelada. Si quieres reagendar, responde a este mensaje. — {{5}}",
  },
  {
    name: "tuvetia_cita_recordatorio",
    text: "Hola {{1}}, te recordamos la cita de {{2}}: {{3}} a las {{4}}. Si necesitas reprogramar o cancelar, responde a este mensaje. — {{5}}",
  },
]

for (const tpl of TEMPLATES) {
  const body = {
    name: tpl.name,
    language: "es",
    category: "UTILITY",
    components: [{ type: "BODY", text: tpl.text, example: { body_text: EXAMPLE } }],
  }
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
  const text = await res.text()
  console.log(`${res.ok ? "✓" : "✗"} ${tpl.name} → ${res.status} ${text.slice(0, 200)}`)
}

console.log("\nLas plantillas quedan PENDIENTES de aprobación de Meta (horas a días).")

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { clinicaDeLaSesion } from "@/lib/api/clinica-de-la-sesion"
import { createAdminClient } from "@/lib/supabase/admin"
import { encryptToken } from "@/lib/whatsapp/crypto"

// Cierre del Embedded Signup de Meta (Cloud API directa, sin redirects): el popup del SDK de FB
// devuelve un `code` + el evento WA_EMBEDDED_SIGNUP trae waba_id y phone_number_id. Acá:
//   1. code → business token del cliente (server-side, con el app secret).
//   2. register del número (tolera "ya registrado": en coexistencia el pairing por QR ya lo hizo).
//   3. subscribed_apps sobre el WABA (habilita los webhooks).
//   4. upsert de whatsapp_integrations con provider='meta' y el token CIFRADO.
// Envs: META_APP_ID, META_APP_SECRET (+ NEXT_PUBLIC_META_ES_CONFIG_ID en el front) y
// WHATSAPP_TOKEN_KEY para el cifrado.

const GRAPH_BASE = "https://graph.facebook.com/v23.0"
const TIMEOUT_MS = 20_000

export async function POST(req: Request) {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    return NextResponse.json({ error: "Integración con Meta no configurada" }, { status: 503 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  const { clinicId } = sesion

  const body = (await req.json().catch(() => ({}))) as {
    code?: string
    waba_id?: string
    phone_number_id?: string
  }
  if (!body.code || !body.waba_id || !body.phone_number_id) {
    return NextResponse.json({ error: "Faltan code, waba_id o phone_number_id" }, { status: 400 })
  }

  try {
    // 1) code → token del cliente (Facebook Login for Business; suele ser de larga vida).
    const tokenRes = await fetch(
      `${GRAPH_BASE}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(body.code)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    )
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string
      expires_in?: number
      error?: { message?: string }
    }
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(`Intercambio de código falló: ${tokenJson.error?.message ?? tokenRes.status}`)
    }
    const accessToken = tokenJson.access_token
    const expiresAt = tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
      : null

    // 2) Registrar el número en Cloud API. En coexistencia el QR ya lo dejó operativo: un error
    //    "ya registrado" no es fallo.
    const regRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(body.phone_number_id)}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin: process.env.META_REGISTER_PIN ?? "000000" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!regRes.ok) {
      const regBody = await regRes.text().catch(() => "")
      const alreadyRegistered = /already|registered/i.test(regBody)
      if (!alreadyRegistered) console.warn("whatsapp/exchange register:", regRes.status, regBody.slice(0, 300))
    }

    // 3) Suscribir nuestra app al WABA → los webhooks empiezan a llegar.
    const subRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(body.waba_id)}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!subRes.ok) {
      const subBody = await subRes.text().catch(() => "")
      throw new Error(`subscribed_apps falló: ${subRes.status} ${subBody.slice(0, 200)}`)
    }

    // 4) Número visible para la UI.
    let phoneNumber: string | null = null
    try {
      const pnRes = await fetch(
        `${GRAPH_BASE}/${encodeURIComponent(body.phone_number_id)}?fields=display_phone_number`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
      )
      const pnJson = (await pnRes.json().catch(() => ({}))) as { display_phone_number?: string }
      phoneNumber = pnJson.display_phone_number ?? null
    } catch {
      // no bloquea la conexión; "Verificar" lo completa después
    }

    const admin = createAdminClient()
    const { error: upErr } = await admin.from("whatsapp_integrations").upsert(
      {
        clinic_id: clinicId,
        provider: "meta",
        status: "connected",
        waba_id: body.waba_id,
        meta_phone_number_id: body.phone_number_id,
        phone_number: phoneNumber,
        access_token_enc: encryptToken(accessToken),
        token_expires_at: expiresAt,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id" },
    )
    if (upErr) throw new Error(`No se pudo guardar la integración: ${upErr.message}`)

    return NextResponse.json({ ok: true, status: "connected", phone_number: phoneNumber })
  } catch (e) {
    console.error("whatsapp/exchange:", e)
    return NextResponse.json(
      { error: "No se pudo completar la conexión con WhatsApp. Intenta de nuevo." },
      { status: 502 },
    )
  }
}

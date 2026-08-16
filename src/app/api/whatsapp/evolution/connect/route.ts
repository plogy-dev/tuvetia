import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { clinicaDeLaSesion } from "@/lib/api/clinica-de-la-sesion"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureInstance, getConnectQr } from "@/lib/whatsapp/evolution"

export const runtime = "nodejs"

// Conexión de WhatsApp vía Evolution (Baileys, NO oficial): crea/reusa la instancia de la clínica,
// registra el webhook y devuelve el QR para escanear DENTRO de tuvetia — cero redirects, cero
// trámites. Requiere consentimiento explícito del vet (integración no oficial: riesgo de baneo
// del número — queda registrado quién y cuándo aceptó).
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const parsed = z
    .object({ consent: z.boolean().optional() })
    .safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 })

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  const { clinicId } = sesion

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("whatsapp_integrations")
    .select("unofficial_consent_at")
    .eq("clinic_id", clinicId)
    .maybeSingle()
  const hasConsent = Boolean((existing as { unofficial_consent_at: string | null } | null)?.unofficial_consent_at)
  if (!hasConsent && !parsed.data.consent) {
    return NextResponse.json({ error: "consent_required" }, { status: 428 })
  }

  const instanceName = `tuvetia_${clinicId.replace(/-/g, "")}`
  try {
    await ensureInstance(instanceName)
    const { qr, state } = await getConnectQr(instanceName)

    const now = new Date().toISOString()
    const { error: upErr } = await admin.from("whatsapp_integrations").upsert(
      {
        clinic_id: clinicId,
        provider: "evolution",
        status: state === "open" ? "connected" : "pending",
        evolution_instance: instanceName,
        ...(hasConsent ? {} : { unofficial_consent_at: now, unofficial_consent_by: user.id }),
        updated_at: now,
      },
      { onConflict: "clinic_id" },
    )
    if (upErr) throw new Error(`No se pudo guardar la integración: ${upErr.message}`)

    if (!hasConsent) {
      await admin.from("audit_logs").insert({
        clinic_id: clinicId,
        user_id: user.id,
        action: "whatsapp.unofficial_consent",
        table_name: "whatsapp_integrations",
        payload: { provider: "evolution" },
      })
    }

    return NextResponse.json({ qr, state })
  } catch (e) {
    console.error("whatsapp/evolution/connect:", e)
    return NextResponse.json(
      { error: "No se pudo iniciar la conexión. Verifica que el servicio de WhatsApp esté disponible." },
      { status: 503 },
    )
  }
}

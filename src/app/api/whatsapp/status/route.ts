import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { clinicaDeLaSesion } from "@/lib/api/clinica-de-la-sesion"
import { createAdminClient } from "@/lib/supabase/admin"
import { providerFor } from "@/lib/whatsapp/provider"
import { loadIntegration } from "@/lib/whatsapp/send-message"

// Refresca el estado de la conexión de WhatsApp de la clínica consultando al proveedor del tenant
// (Kapso o Meta directo). Se llama al volver del onboarding o con el botón "Verificar conexión".
// connected_at solo se escribe al transicionar a connected (no se pisa en cada verificación).
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  const { clinicId } = sesion

  try {
    const integ = await loadIntegration(clinicId)
    if (!integ || (!integ.kapso_customer_id && !integ.waba_id && !integ.evolution_instance))
      return NextResponse.json({ status: "none" })

    const fresh = await providerFor(integ).refreshStatus(integ)
    const admin = createAdminClient()

    if (fresh.status !== "connected") {
      if (fresh.status === "disconnected" && integ.status !== "disconnected") {
        await admin
          .from("whatsapp_integrations")
          .update({ status: "disconnected", updated_at: new Date().toISOString() })
          .eq("clinic_id", clinicId)
      }
      return NextResponse.json({ status: fresh.status, reason: fresh.reason })
    }

    // Evolution no tiene phone_number_id (rutea por instancia); Kapso/Meta sí.
    const phoneColumn = integ.provider === "meta" ? "meta_phone_number_id" : "kapso_phone_number_id"
    const { error: upErr } = await admin
      .from("whatsapp_integrations")
      .update({
        status: "connected",
        phone_number: fresh.phoneNumber,
        ...(fresh.phoneNumberId ? { [phoneColumn]: fresh.phoneNumberId } : {}),
        ...(integ.status !== "connected" ? { connected_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("clinic_id", clinicId)
    if (upErr) throw new Error(`No se pudo guardar el estado: ${upErr.message}`)
    return NextResponse.json({ status: "connected", phone_number: fresh.phoneNumber })
  } catch (e) {
    // El detalle completo (con el body crudo del proveedor) va al log del servidor, no al toast.
    console.error("whatsapp/status:", e)
    return NextResponse.json(
      { error: "No se pudo verificar la conexión con el proveedor de WhatsApp. Intenta de nuevo en unos minutos." },
      { status: 503 },
    )
  }
}

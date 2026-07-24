import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { listPhoneNumbers } from "@/lib/kapso"

// Refresca el estado de la conexión de WhatsApp de la clínica consultando Kapso.
// Se llama al volver del setup link (?whatsapp=connected) o con el botón "Verificar conexión".
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

  try {
    const admin = createAdminClient()
    const { data: integ } = await admin
      .from("whatsapp_integrations")
      .select("kapso_customer_id")
      .eq("clinic_id", clinicId)
      .maybeSingle()
    const customerId = (integ as { kapso_customer_id: string } | null)?.kapso_customer_id
    if (!customerId) return NextResponse.json({ status: "none" })

    const numbers = await listPhoneNumbers()
    // Preferir el número del customer de esta clínica; si Kapso no expone customer_id en el listado,
    // no adivinamos (queda pendiente y el webhook/el otro dev lo completan).
    const mine = numbers.find((n) => n.customer_id === customerId)
    if (!mine) return NextResponse.json({ status: "pending" })

    const phone = mine.display_phone_number ?? mine.phone_number ?? null
    await admin
      .from("whatsapp_integrations")
      .update({
        status: "connected",
        phone_number: phone,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("clinic_id", clinicId)
    return NextResponse.json({ status: "connected", phone_number: phone })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
}

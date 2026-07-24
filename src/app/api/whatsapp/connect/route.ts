import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createKapsoCustomer, createSetupLink } from "@/lib/kapso"

// Inicia (o reanuda) la conexión de WhatsApp de la clínica vía Kapso:
// crea/reusa el customer de Kapso para la clínica, genera un setup link hosteado (QR/coexistence)
// y lo devuelve para que el front lo abra. Estado persistido en whatsapp_integrations (service_role).
export async function POST(req: Request) {
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

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }

  try {
    // Reusar el customer si la clínica ya inició la conexión antes.
    const { data: existing } = await admin
      .from("whatsapp_integrations")
      .select("kapso_customer_id")
      .eq("clinic_id", clinicId)
      .maybeSingle()

    let kapsoCustomerId = (existing as { kapso_customer_id: string } | null)?.kapso_customer_id
    if (!kapsoCustomerId) {
      const { data: clinic } = await admin
        .from("clinics")
        .select("name")
        .eq("id", clinicId)
        .maybeSingle()
      const clinicName = (clinic as { name: string } | null)?.name ?? "Clínica"
      kapsoCustomerId = await createKapsoCustomer(clinicId, clinicName)
    }

    const origin = new URL(req.url).origin
    const setupUrl = await createSetupLink(kapsoCustomerId, `${origin}/dashboard/settings?whatsapp=connected`)

    await admin.from("whatsapp_integrations").upsert(
      {
        clinic_id: clinicId,
        kapso_customer_id: kapsoCustomerId,
        setup_link_url: setupUrl,
        status: "pending",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id" },
    )

    return NextResponse.json({ setup_url: setupUrl })
  } catch (e) {
    // Sin KAPSO_API_KEY (u otro fallo de Kapso) devolvemos el motivo — el front lo muestra en un toast.
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
}

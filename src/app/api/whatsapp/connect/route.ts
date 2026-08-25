import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { clinicaDeLaSesion } from "@/lib/api/clinica-de-la-sesion"
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

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  const { clinicId } = sesion

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
      // Persistir el customer APENAS se obtiene: si el setup link fallara después, el reintento lo
      // reutiliza desde la BD (evita el estado huérfano "existe en Kapso pero no acá").
      const { error: upErr } = await admin.from("whatsapp_integrations").upsert(
        {
          clinic_id: clinicId,
          kapso_customer_id: kapsoCustomerId,
          status: "pending",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "clinic_id" },
      )
      if (upErr) throw new Error(`No se pudo guardar la integración: ${upErr.message}`)
    }

    // El origin NUNCA se deriva de req.url a secas: detrás del proxy de Vercel puede resolver al
    // deployment URL y el usuario volvería de Kapso a un dominio sin sesión (pariente del bug OAuth
    // del fix 3203eb4). Prioridad: env explícita → host reenviado por el proxy → req.url.
    const fwdHost = req.headers.get("x-forwarded-host")
    const fwdProto = req.headers.get("x-forwarded-proto") ?? "https"
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ?? (fwdHost ? `${fwdProto}://${fwdHost}` : new URL(req.url).origin)
    const setupUrl = await createSetupLink(kapsoCustomerId, `${origin}/dashboard/administracion/clinica?tab=cuenta&whatsapp=connected`)

    const { error: linkErr } = await admin
      .from("whatsapp_integrations")
      .update({ setup_link_url: setupUrl, updated_at: new Date().toISOString() })
      .eq("clinic_id", clinicId)
    if (linkErr) throw new Error(`No se pudo guardar el setup link: ${linkErr.message}`)

    return NextResponse.json({ setup_url: setupUrl })
  } catch (e) {
    // Sin KAPSO_API_KEY (u otro fallo de Kapso) devolvemos el motivo — el front lo muestra en un toast.
    return NextResponse.json({ error: (e as Error).message }, { status: 503 })
  }
}

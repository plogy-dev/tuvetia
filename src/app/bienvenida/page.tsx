import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { WelcomeWizard } from "@/components/onboarding/welcome-wizard"

export const metadata = { title: "Bienvenida · TuvetIA" }

// Wizard de configuración inicial para el vet que CREA su clínica (los invitados y los usuarios
// preexistentes tienen setup_completed_at y nunca llegan acá). Todo saltable.
export default async function BienvenidaPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/")

  const { data: prof } = await supabase
    .from("profiles")
    .select("full_name, role, clinic_id, setup_completed_at")
    .eq("id", user.id)
    .maybeSingle()
  const p = prof as {
    full_name: string | null
    role: string | null
    clinic_id: string | null
    setup_completed_at: string | null
  } | null

  // Ya completado (o sin clínica todavía) -> al dashboard.
  if (!p?.clinic_id || p.setup_completed_at) redirect("/dashboard")

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", p.clinic_id)
    .maybeSingle()

  return (
    <WelcomeWizard
      userId={user.id}
      clinicId={p.clinic_id}
      initialClinicName={(clinic as { name: string } | null)?.name ?? ""}
      initialFullName={p.full_name ?? ""}
      isAdmin={p.role === "admin"}
    />
  )
}

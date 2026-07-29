import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { WorkspaceSetup } from "@/components/onboarding/workspace-setup"

export const metadata = { title: "Configura tu clínica · Tuvetia" }

// Onboarding: pantalla única para personalizar la clínica (logo + nombre) que el trigger de BD
// on_auth_user_confirmed ya creó con un nombre placeholder. Los invitados y usuarios preexistentes
// tienen setup_completed_at y nunca llegan acá.
export default async function BienvenidaPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id, setup_completed_at")
    .eq("id", user.id)
    .maybeSingle()
  const p = prof as { clinic_id: string | null; setup_completed_at: string | null } | null

  // Ya completado (o sin clínica todavía) -> al dashboard.
  if (!p?.clinic_id || p.setup_completed_at) redirect("/dashboard")

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name, logo_url")
    .eq("id", p.clinic_id)
    .maybeSingle()
  const c = clinic as { name: string; logo_url: string | null } | null

  return (
    <WorkspaceSetup
      clinicId={p.clinic_id}
      initialClinicName={c?.name ?? ""}
      initialLogoUrl={c?.logo_url ?? null}
    />
  )
}

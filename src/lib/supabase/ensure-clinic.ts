import type { SupabaseClient, User } from "@supabase/supabase-js"

export async function ensureClinicForUser(
  supabase: SupabaseClient,
  user: User
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .single()

  if (!profile || profile.clinic_id) return

  const meta = user.user_metadata ?? {}
  const clinicName =
    meta.clinic_name ||
    `Clinica de ${meta.full_name || meta.name || user.email?.split("@")[0] || "usuario"}`

  await supabase.rpc("create_clinic", { clinic_name: clinicName })
}

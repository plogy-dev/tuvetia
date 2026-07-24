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

  // Si el usuario tiene una invitación pendiente a otra clínica, NO le creamos una clínica propia:
  // la página /invitar/[token] lo asignará al aceptar (evita clínicas huérfanas de invitados).
  const { data: hasInvite } = await supabase.rpc("has_pending_invitation")
  if (hasInvite === true) return

  const meta = user.user_metadata ?? {}
  const clinicName =
    meta.clinic_name ||
    `Clinica de ${meta.full_name || meta.name || user.email?.split("@")[0] || "usuario"}`

  await supabase.rpc("create_clinic", { clinic_name: clinicName })
}

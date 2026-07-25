import { createClient } from "@/lib/supabase/server"
import { Assistant, type AssistantPatient } from "./assistant"

export const metadata = { title: "Asistente · TuvetIA" }

// Server component: resuelve clínica y pacientes ANTES del primer paint y se los pasa al chat.
// Antes el cliente hacía getUser -> profiles -> patients en serie desde el navegador.
export default async function AsistentePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let clinicId = ""
  let patients: AssistantPatient[] = []
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("clinic_id")
      .eq("id", user.id)
      .maybeSingle()
    clinicId = (profile as { clinic_id: string | null } | null)?.clinic_id ?? ""
    if (clinicId) {
      const { data: pts } = await supabase
        .from("patients")
        .select("id,name,species")
        .eq("clinic_id", clinicId)
        .order("name")
        .limit(500)
      patients = (pts as AssistantPatient[] | null) ?? []
    }
  }

  return <Assistant clinicId={clinicId} patients={patients} />
}

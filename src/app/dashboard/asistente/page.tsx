import { createClient } from "@/lib/supabase/server"
import {
  TOPE_MENSAJES,
  agruparPorPaciente,
  type MensajeFila,
  type StoredThreads,
} from "@/lib/athos-history"
import { Assistant, type AssistantPatient } from "./assistant"

export const metadata = { title: "Asistente · Tuvetia" }

// Server component: resuelve clínica, pacientes E HISTORIAL antes del primer paint.
// El historial se precarga porque `athos_messages` guardaba la conversación desde el inicio y el
// asistente NO la mostraba: al recargar la página el hilo se veía vacío aunque los mensajes
// estuvieran en la base, y el cliente lo reportó como "historial inexistente" (§4.5 de la auditoría).
export default async function AsistentePage({
  searchParams,
}: {
  // `?patient=` lo pone el historial del sidebar al abrir un chat ya existente.
  searchParams: Promise<{ patient?: string }>
}) {
  const { patient: patientParam } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let clinicId = ""
  let patients: AssistantPatient[] = []
  let threads: StoredThreads = {}
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("clinic_id")
      .eq("id", user.id)
      .maybeSingle()
    clinicId = (profile as { clinic_id: string | null } | null)?.clinic_id ?? ""
    if (clinicId) {
      // Pacientes e historial en paralelo: son independientes.
      const [pts, msgs] = await Promise.all([
        supabase
          .from("patients")
          .select("id,name,species")
          .eq("clinic_id", clinicId)
          .order("name")
          .limit(500),
        // La RLS ya acota por clínica; el patient_id null es la consulta general, que el backend
        // trata como sin estado y por eso se descarta acá.
        supabase
          .from("athos_messages")
          .select("id,patient_id,role,content,created_at")
          .eq("clinic_id", clinicId)
          .not("patient_id", "is", null)
          .in("role", ["user", "assistant"])
          .order("created_at", { ascending: false })
          .limit(TOPE_MENSAJES),
      ])
      patients = (pts.data as AssistantPatient[] | null) ?? []
      threads = agruparPorPaciente((msgs.data as MensajeFila[] | null) ?? [])
    }
  }

  // Sólo se acepta un paciente que exista y sea de esta clínica: `patients` ya viene filtrado por
  // `clinic_id`, así que un id ajeno o inventado en la URL simplemente se ignora.
  const initialPatientId =
    patientParam && patients.some((p) => p.id === patientParam) ? patientParam : undefined

  return (
    <Assistant
      clinicId={clinicId}
      patients={patients}
      threads={threads}
      initialPatientId={initialPatientId}
    />
  )
}

import { createClient } from "@/lib/supabase/server"

// Exportación de los datos de la clínica en formato abierto (JSON) — respalda la promesa de
// no-lock-in: "podés llevarte todos tus datos en cualquier momento". Usa el cliente del USUARIO
// (RLS): solo exporta lo de su clínica, sin service_role. Se descarga como archivo.

const TABLES: { name: string; columns: string }[] = [
  { name: "owners", columns: "id, full_name, phone, email, document_id, address, notes, created_at" },
  { name: "patients", columns: "id, owner_id, name, species, breed, sex, birth_date, weight_kg, color, microchip, is_deceased, notes, created_at" },
  { name: "allergies", columns: "id, patient_id, allergen, severity, reaction, confirmed, created_at" },
  { name: "vaccines", columns: "id, patient_id, vaccine_name, batch_number, dose, administered_at, next_dose_at, notes, created_at" },
  { name: "medications", columns: "id, patient_id, drug_name, dose, frequency, route, start_date, end_date, is_chronic, notes, created_at" },
  { name: "appointments", columns: "id, patient_id, owner_id, title, reason, status, starts_at, ends_at, notes, created_at" },
  { name: "consultations", columns: "id, patient_id, owner_id, status, chief_complaint, started_at, ended_at, created_at" },
  { name: "transcripts", columns: "id, consultation_id, full_text, language, created_at" },
  // Sin `ai_model`: el export se lo lleva el cliente, y el id crudo del motor no sale de casa.
  // `ai_generated_at` sí va — dice que la redactó Athos, que es lo que el vet necesita saber.
  { name: "clinical_notes", columns: "id, consultation_id, status, subjective, objective, assessment, plan, citations, allergy_gate_triggered, ai_generated_at, approved_at, created_at" },
  { name: "whatsapp_messages", columns: "id, owner_id, wa_phone_from, wa_phone_to, direction, body, media_type, created_at" },
]

const PAGE = 1000

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response("No autenticado", { status: 401 })

  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    format: "tuvetia-export-v1",
    note: "Datos de tu clínica en formato abierto (JSON). RLS: solo incluye lo que tu usuario puede ver.",
  }

  for (const t of TABLES) {
    const rows: unknown[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(t.name)
        .select(t.columns)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) {
        // Tabla inaccesible (p.ej. permiso) -> se reporta sin romper el resto del export.
        out[t.name] = { error: error.message }
        break
      }
      rows.push(...(data ?? []))
      if (!data || data.length < PAGE) {
        out[t.name] = rows
        break
      }
    }
  }

  const date = new Date().toISOString().slice(0, 10)
  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="tuvetia-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  })
}

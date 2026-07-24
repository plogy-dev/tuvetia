import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Datos de ejemplo del onboarding: paciente "Luna (ejemplo)" con consulta transcrita y nota SOAP
// draft, para que el vet explore el Modo Fantasma sin grabar nada. Marcador: el titular
// "Ejemplo — TuvetIA" (DELETE borra por él; los FKs en cascada limpian todo).
// La nota va SIN citas (citations=[]) a propósito: no fabricamos referencias bibliográficas.

const DEMO_OWNER = "Ejemplo — TuvetIA"

const DEMO_TRANSCRIPT = [
  "Veterinario: Hola, cuéntame ¿qué le pasa a Luna?",
  "Titular: Doctor, desde anoche vomitó tres veces y no quiere comer nada.",
  "Veterinario: ¿Comió algo fuera de lo normal? ¿Basura, huesos, algún alimento nuevo?",
  "Titular: Ayer en el parque se comió algo del piso, no alcancé a ver qué era.",
  "Veterinario: Bien. A la palpación el abdomen está algo tenso pero sin dolor agudo. Temperatura 38.6, mucosas rosadas, hidratación normal.",
  "Titular: ¿Es grave?",
  "Veterinario: Por ahora parece una gastritis aguda por indiscreción alimentaria. Vamos con dieta blanda 24 horas, agua en tomas pequeñas y control mañana. Si vomita de nuevo o decae, me la traes de inmediato.",
].join("\n")

const DEMO_SOAP = {
  subjective:
    "Titular reporta 3 episodios de vómito desde anoche e hiporexia. Posible ingesta de material desconocido en el parque el día previo.",
  objective:
    "Abdomen levemente tenso a la palpación, sin dolor agudo. T° 38.6 °C, mucosas rosadas, TLC normal, hidratación adecuada.",
  assessment:
    "Cuadro compatible con gastritis aguda por indiscreción alimentaria. No se observan signos de alarma al examen físico.",
  plan:
    "Dieta blanda por 24 h, agua en tomas pequeñas y frecuentes. Control en 24 h. Acudir de inmediato si hay nuevos vómitos, decaimiento o dolor abdominal.",
}

async function clinicOf(userId: string) {
  const admin = createAdminClient()
  const { data } = await admin.from("profiles").select("clinic_id").eq("id", userId).maybeSingle()
  return { admin, clinicId: (data as { clinic_id: string | null } | null)?.clinic_id ?? null }
}

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  try {
    const { admin, clinicId } = await clinicOf(user.id)
    if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

    // Idempotente: si el demo ya existe, no duplicar.
    const { data: existing } = await admin
      .from("owners")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("full_name", DEMO_OWNER)
      .maybeSingle()
    if (existing) return NextResponse.json({ ok: true, already: true })

    const { data: owner, error: oErr } = await admin
      .from("owners")
      .insert({ clinic_id: clinicId, full_name: DEMO_OWNER })
      .select("id")
      .single()
    if (oErr) throw new Error(oErr.message)

    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({
        clinic_id: clinicId,
        owner_id: (owner as { id: string }).id,
        name: "Luna (ejemplo)",
        species: "Perro",
        breed: "Criollo",
        weight_kg: 12,
        notes: "Paciente de ejemplo creado por el onboarding — se puede borrar desde el dashboard.",
      })
      .select("id")
      .single()
    if (pErr) throw new Error(pErr.message)

    const { data: consultation, error: cErr } = await admin
      .from("consultations")
      .insert({
        clinic_id: clinicId,
        patient_id: (patient as { id: string }).id,
        owner_id: (owner as { id: string }).id,
        vet_id: user.id,
        status: "review",
        chief_complaint: "Vómitos y falta de apetito (ejemplo)",
      })
      .select("id")
      .single()
    if (cErr) throw new Error(cErr.message)

    const consultationId = (consultation as { id: string }).id
    const { error: tErr } = await admin.from("transcripts").insert({
      clinic_id: clinicId,
      consultation_id: consultationId,
      full_text: DEMO_TRANSCRIPT,
      stt_provider: "demo",
      stt_model: "ejemplo",
    })
    if (tErr) throw new Error(tErr.message)

    const { error: nErr } = await admin.from("clinical_notes").insert({
      clinic_id: clinicId,
      consultation_id: consultationId,
      status: "draft",
      ...DEMO_SOAP,
      citations: [],
      ai_model: "ejemplo (datos de demostración)",
      ai_generated_at: new Date().toISOString(),
    })
    if (nErr) throw new Error(nErr.message)

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  try {
    const { admin, clinicId } = await clinicOf(user.id)
    if (!clinicId) return NextResponse.json({ error: "El usuario no tiene clínica" }, { status: 400 })

    // Borrar el titular demo: los FKs en cascada limpian paciente -> consulta -> transcript/nota.
    const { error } = await admin
      .from("owners")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("full_name", DEMO_OWNER)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

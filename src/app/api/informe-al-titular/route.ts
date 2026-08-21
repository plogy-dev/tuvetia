// Redacta el borrador del informe que se lleva el titular.
//
// TRES GUARDAS ANTES DE GASTAR UN TOKEN, en este orden y por este motivo:
//
//   1. **Sesión.** Sin vet no hay clínica, y sin clínica no hay a quién cobrarle el gasto.
//   2. **Nota aprobada** (regla 5). Un informe derivado de un borrador se saltearía la aprobación
//      por la puerta que da a la calle. La 0071 lo impone además con un trigger; acá se atrapa
//      antes, para no pagar una llamada que la base va a rechazar al guardar.
//   3. **Cupo.** Es una llamada más de la clínica y cuenta como tal. El techo mensual existe para
//      que una función nueva no se coma el presupuesto sin que nadie lo note.
//
// CORRE BAJO LA SESIÓN DEL VET para leer, así que la RLS acota por clínica sola. El `clinic_id` que
// se usa para el cupo y el registro sale del perfil, explícito — regla 7.
//
// NO GUARDA NADA. Devuelve un borrador y se acabó: lo que se guarda es lo que el vet aprueba
// después de editarlo, y eso lo escribe el cliente contra `client_reports`. Entre el texto del
// modelo y el papel que se lleva el dueño hay una persona, y ésa es toda la diferencia.

import { NextResponse } from "next/server"
import { generateText } from "ai"

import { createClient } from "@/lib/supabase/server"
import { agentModel } from "@/lib/athos-agent/model"
import { registrarUso } from "@/lib/athos-agent/usage"
import { consultarPresupuesto, mensajeSinCupo } from "@/lib/athos-agent/presupuesto"
import { bogotaDateOnly } from "@/lib/date-utils"
import {
  MOTIVOS,
  firmaPorDefecto,
  limpiarInforme,
  pedidoDelInforme,
  sePuedeInformar,
} from "@/lib/informe-al-titular/armar"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const { consultation_id } = (await req.json().catch(() => ({}))) as { consultation_id?: string }
  if (!consultation_id) return NextResponse.json({ error: "Falta la consulta." }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 })

  const { data: perfil } = await supabase
    .from("profiles")
    .select("clinic_id, full_name")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (perfil as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) return NextResponse.json({ error: "No hay clínica activa." }, { status: 400 })

  const [{ data: consulta }, { data: nota }, { data: clinica }] = await Promise.all([
    supabase
      .from("consultations")
      .select("id, started_at, patient:patients(name, species, owner:owners(full_name))")
      .eq("id", consultation_id)
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase
      .from("clinical_notes")
      .select("status, subjective, objective, assessment, plan")
      .eq("consultation_id", consultation_id)
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("clinics").select("name").eq("id", clinicId).maybeSingle(),
  ])

  if (!consulta) return NextResponse.json({ error: "No se encontró la consulta." }, { status: 404 })

  const puede = sePuedeInformar(nota as { status: string } | null)
  if (!puede.puede) return NextResponse.json({ error: MOTIVOS[puede.motivo] }, { status: 409 })

  // EL CUPO SE MIRA DESPUÉS DE LAS GUARDAS BARATAS y antes de la llamada. Preguntar por el cupo
  // cuesta una consulta; llamar al modelo cuesta plata.
  const presupuesto = await consultarPresupuesto(clinicId)
  if (!presupuesto.permitido) {
    return NextResponse.json({ error: mensajeSinCupo(presupuesto) }, { status: 429 })
  }

  const c = consulta as unknown as {
    started_at: string
    patient: { name: string; species: string | null; owner: { full_name: string } | null } | null
  }
  const firma = firmaPorDefecto(
    (perfil as { full_name: string | null } | null)?.full_name,
    (clinica as { name: string } | null)?.name,
  )

  const pedido = pedidoDelInforme({
    nota: nota as { status: string },
    paciente: { nombre: c.patient?.name ?? "el paciente", especie: c.patient?.species },
    titular: { nombre: c.patient?.owner?.full_name ?? null },
    clinica: (clinica as { name: string } | null)?.name ?? null,
    fecha: c.started_at ? bogotaDateOnly(c.started_at) : null,
  })

  const elegido = agentModel()
  try {
    const r = await generateText({ model: elegido.model, prompt: pedido })
    // EL REGISTRO VA AUNQUE EL TEXTO VENGA VACÍO: los tokens se pagaron igual. Contar sólo los
    // éxitos es la forma más limpia de que la factura no cuadre con la medición.
    await registrarUso({
      clinicId,
      userId: user.id,
      surface: "informe_titular",
      elegido,
      usage: r.usage,
    })
    const informe = limpiarInforme(r.text ?? "", firma)
    if (!informe.body.trim()) {
      return NextResponse.json(
        { error: "El modelo no devolvió un informe utilizable. Probá de nuevo." },
        { status: 502 },
      )
    }
    return NextResponse.json({ informe, generated_at: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

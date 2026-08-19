// "Casos parecidos": consultas ANTERIORES de la clínica que se parecen a la que está pasando.
//
// ES LA PESTAÑA DEL PROTOTIPO, y es distinta de "Sugerencias": aquélla trae literatura veterinaria,
// ésta trae la memoria del propio consultorio. "Esto ya lo viste en marzo, con Nala."
//
// NO GASTA CUPO DE IA, y es deliberado. La inteligencia en vivo ya consume `athos_agent_usage` con
// un techo por consulta; sumarle otra llamada de modelo cada vez que el vet abre una pestaña
// volvería la función impagable. Acá no hay modelo: se sacan las palabras distintivas de la
// transcripción (`lib/consulta-viva/terminos.ts`, cero tokens) y se buscan sobre las notas que la
// clínica ya escribió.
//
// CORRE CON LA SESIÓN DEL VET, no con service_role: la RLS es la que garantiza que una clínica no
// vea las consultas de otra. Es la misma regla que el resto de las lecturas del producto.

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { terminosDeBusqueda } from "@/lib/consulta-viva/terminos"

export const runtime = "nodejs"

/** Cuántos casos se devuelven. Más de esto no se lee de reojo mientras se atiende. */
const TOPE = 5

type Fila = {
  id: string
  started_at: string
  patient: { name: string; species: string | null } | null
  notes: { assessment: string | null }[] | null
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 })

  const cuerpo = (await req.json().catch(() => ({}))) as {
    transcript?: unknown
    consultation_id?: unknown
  }
  const transcript = typeof cuerpo.transcript === "string" ? cuerpo.transcript : ""
  const excluir = typeof cuerpo.consultation_id === "string" ? cuerpo.consultation_id : null

  const terminos = terminosDeBusqueda(transcript)
  // Sin términos no se busca: devolver "las últimas cinco consultas" bajo el rótulo de PARECIDAS
  // sería mentir, y el vet las leería como relacionadas con lo que tiene delante.
  if (terminos.length === 0) return NextResponse.json({ terminos: [], casos: [] })

  // `or` con un `ilike` por término: alcanza con que UNA palabra coincida. Exigirlas todas no
  // encuentra nada — dos consultas del mismo cuadro rara vez comparten cuatro palabras.
  const filtro = terminos.map((t) => `assessment.ilike.%${t.replace(/[%_,]/g, "")}%`).join(",")

  const { data, error } = await supabase
    .from("consultations")
    .select("id, started_at, patient:patients(name, species), notes:clinical_notes!inner(assessment)")
    .or(filtro, { foreignTable: "notes" })
    .order("started_at", { ascending: false })
    .limit(TOPE + 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const casos = ((data as unknown as Fila[] | null) ?? [])
    // La consulta EN CURSO no es un caso parecido a sí misma.
    .filter((c) => c.id !== excluir)
    .slice(0, TOPE)
    .map((c) => ({
      id: c.id,
      fecha: c.started_at,
      paciente: c.patient?.name ?? "—",
      especie: c.patient?.species ?? null,
      // El recorte va acá y no en el cliente: lo que viaja es lo que se muestra.
      resumen: (c.notes?.[0]?.assessment ?? "").slice(0, 240),
    }))

  return NextResponse.json({ terminos, casos })
}

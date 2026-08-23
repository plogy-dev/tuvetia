// El detalle de una pastilla del tablero, sin salir del tablero.
//
// LO QUE PIDIO EL CLIENTE, el 19-ago:
//
//   Luciano: "no que te full redireccione, sino que simplemente sea como una vista mas directa...
//             como una sub pagina, sabes, como que sea la misma pagina pero una vista mas directa"
//   Felipe:  "como un mini previo"
//
// Lo obvio era navegar, y Luciano se adelanto a pedir que no: la pregunta que dispara una cifra
// —"¿cuales son esas nueve citas?"— dura dos segundos, y sacar al vet a la agenda le cuesta perder
// de vista todo lo demas que estaba mirando, que es para lo que existe un tablero.
//
// SE PIDE AL ABRIR, no con el tablero. Son cuatro listas que casi nunca se miran: traerlas siempre
// serian cuatro consultas mas en cada carga del tablero para responder preguntas que nadie hizo.
//
// CORRE CON LA SESION DEL VET. La RLS es la que acota por clinica, igual que el resto de las
// lecturas — y los filtros de cada metrica son LOS MISMOS que los del conteo, para que el detalle
// no contradiga a la cifra que lo abrio.

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

/** Cuantas filas entran en una vista rapida. Mas que esto ya es la pantalla de la seccion. */
const TOPE = 8

type Fila = { id: string; titulo: string; detalle: string | null; cuando: string | null }

export async function GET(req: Request) {
  const metrica = new URL(req.url).searchParams.get("metrica") ?? ""

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 })

  const ahora = new Date()
  const inicioDeMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1)
  const enSieteDias = new Date(ahora.getTime() + 7 * 864e5)

  let filas: Fila[] = []
  let error: string | null = null

  if (metrica === "consultas-mes") {
    const { data, error: e } = await supabase
      .from("consultations")
      .select("id, started_at, patient:patients(name, species)")
      .gte("started_at", inicioDeMes.toISOString())
      .order("started_at", { ascending: false })
      .limit(TOPE)
    error = e?.message ?? null
    filas = ((data as unknown as { id: string; started_at: string; patient: { name: string; species: string | null } | null }[] | null) ?? []).map(
      (c) => ({ id: c.id, titulo: c.patient?.name ?? "Consulta", detalle: c.patient?.species ?? null, cuando: c.started_at }),
    )
  } else if (metrica === "pacientes") {
    const { data, error: e } = await supabase
      .from("patients")
      .select("id, name, species, created_at, owner:owners(full_name)")
      .order("created_at", { ascending: false })
      .limit(TOPE)
    error = e?.message ?? null
    filas = ((data as unknown as { id: string; name: string; species: string | null; created_at: string; owner: { full_name: string } | null }[] | null) ?? []).map(
      (p) => ({ id: p.id, titulo: p.name, detalle: [p.species, p.owner?.full_name].filter(Boolean).join(" · ") || null, cuando: p.created_at }),
    )
  } else if (metrica === "citas-7d") {
    const { data, error: e } = await supabase
      .from("appointments")
      .select("id, title, starts_at, patient:patients(name)")
      .gte("starts_at", ahora.toISOString())
      .lte("starts_at", enSieteDias.toISOString())
      // Los MISMOS estados que cuenta la cifra: una cita futura marcada completed no es "proxima".
      .in("status", ["scheduled", "confirmed", "in_progress"])
      .order("starts_at", { ascending: true })
      .limit(TOPE)
    error = e?.message ?? null
    filas = ((data as unknown as { id: string; title: string; starts_at: string; patient: { name: string } | null }[] | null) ?? []).map(
      (a) => ({ id: a.id, titulo: a.patient?.name ?? a.title, detalle: a.patient?.name ? a.title : null, cuando: a.starts_at }),
    )
  } else if (metrica === "notas-borrador") {
    const { data, error: e } = await supabase
      .from("clinical_notes")
      .select("id, created_at, consultation:consultations(id, patient:patients(name))")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(TOPE)
    error = e?.message ?? null
    filas = ((data as unknown as { id: string; created_at: string; consultation: { id: string; patient: { name: string } | null } | null }[] | null) ?? []).map(
      (n) => ({
        // El id que viaja es el de la CONSULTA, no el de la nota: es a donde lleva la fila.
        id: n.consultation?.id ?? n.id,
        titulo: n.consultation?.patient?.name ?? "Consulta",
        detalle: "Borrador por aprobar",
        cuando: n.created_at,
      }),
    )
  // ── Las cuatro cifras de PACIENTES ────────────────────────────────────────────────────────────
  //
  // Lo mismo que pidió Luciano para el tablero, en la otra pantalla que tiene una fila de cifras:
  // que al tocarlas se abra el detalle sin sacarte de donde estás.
  //
  // LOS FILTROS SON COPIA EXACTA de los de `dashboard/patients/page.tsx`, y hay un test que lo
  // vigila: una tarjeta que dice 9 y una vista que muestra 11 es peor que no tener la vista.
  } else if (metrica === "pacientes-activos") {
    // `is_deceased` FALSE, igual que el conteo. La tarjeta siempre dijo "Pacientes activos" y
    // contaba todos: hoy no se nota porque no hay ninguno marcado, y el día que lo haya la cifra
    // habría empezado a mentir sin que nada fallara.
    const { data, error: e } = await supabase
      .from("patients")
      .select("id, name, species, created_at")
      .eq("is_deceased", false)
      .order("created_at", { ascending: false })
      .limit(TOPE)
    error = e?.message ?? null
    filas = ((data as { id: string; name: string; species: string | null; created_at: string }[] | null) ?? []).map(
      (p) => ({ id: p.id, titulo: p.name, detalle: p.species, cuando: p.created_at }),
    )
  } else if (metrica === "citas-hoy") {
    // HOY, no siete días: es la ventana del conteo de esta pantalla, distinta de la del tablero.
    const inicioDelDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
    const finDelDia = new Date(inicioDelDia.getTime() + 864e5)
    const { data, error: e } = await supabase
      .from("appointments")
      .select("id, title, starts_at, patient:patients(name)")
      .gte("starts_at", inicioDelDia.toISOString())
      .lt("starts_at", finDelDia.toISOString())
      .order("starts_at", { ascending: true })
      .limit(TOPE)
    error = e?.message ?? null
    filas = ((data as unknown as { id: string; title: string | null; starts_at: string; patient: { name: string } | null }[] | null) ?? []).map(
      (a) => ({ id: a.id, titulo: a.patient?.name ?? a.title ?? "Cita", detalle: a.title, cuando: a.starts_at }),
    )
  } else if (metrica === "consultas-revision") {
    // `consultations.status = 'review'` — NO es lo mismo que `notas-borrador` del tablero, que
    // mira `clinical_notes.status`. Son dos cifras parecidas de tablas distintas.
    const { data, error: e } = await supabase
      .from("consultations")
      .select("id, started_at, patient:patients(name, species)")
      .eq("status", "review")
      .order("started_at", { ascending: false })
      .limit(TOPE)
    error = e?.message ?? null
    filas = ((data as unknown as { id: string; started_at: string; patient: { name: string; species: string | null } | null }[] | null) ?? []).map(
      (c) => ({ id: c.id, titulo: c.patient?.name ?? "Consulta", detalle: "En revisión", cuando: c.started_at }),
    )
  } else if (metrica === "pacientes-nuevos-mes") {
    const { data, error: e } = await supabase
      .from("patients")
      .select("id, name, species, created_at")
      .gte("created_at", inicioDeMes.toISOString())
      .order("created_at", { ascending: false })
      .limit(TOPE)
    error = e?.message ?? null
    filas = ((data as { id: string; name: string; species: string | null; created_at: string }[] | null) ?? []).map(
      (p) => ({ id: p.id, titulo: p.name, detalle: p.species, cuando: p.created_at }),
    )
  } else {
    return NextResponse.json({ error: "Métrica desconocida." }, { status: 400 })
  }

  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ filas })
}

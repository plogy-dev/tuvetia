// La inteligencia en vivo del Modo Fantasma, POR AQUÍ Y NO DIRECTO AL SERVICIO.
//
// POR QUÉ EXISTE ESTA RUTA. El navegador llamaba a `/athos/live` del microservicio directamente, y
// eso dejaba un agujero: el tope mensual por clínica vive en Next (`athos_agent_usage`), así que un
// gasto que no pasa por acá **no se cuenta**.
//
// Y es justo el gasto que más hay que contar. `presupuesto.ts` ya lo dice de las otras superficies:
// «dejar afuera el modo automático y cartera —las dos que gastan sin que el vet lo note— sería dejar
// el agujero justamente donde está el gasto que nadie mira». Esto es peor todavía: se dispara solo,
// decenas de veces por consulta, mientras el veterinario atiende y sin que nadie apriete nada.
//
// Con la ruta en el medio, el vivo entra al mismo cupo que el chat, aparece en `/admin/costos` con su
// propia etiqueta, y se puede cortar cuando la clínica se pasó.
//
// LO QUE NO CAMBIA: el JWT del vet se reenvía tal cual, así que el servicio sigue autenticando y
// resolviendo la clínica por su cuenta. Esta ruta no le da confianza a nada que venga del navegador
// — el `clinic_id` que usa para el presupuesto sale de la SESIÓN, no del cuerpo.

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { clinicaDeLaSesion, requiereCapacidad } from "@/lib/api/clinica-de-la-sesion"
import { consultarPresupuesto, mensajeSinCupo } from "@/lib/athos-agent/presupuesto"
import { registrarUso } from "@/lib/athos-agent/usage"

export const runtime = "nodejs"
export const maxDuration = 30

const ATHOS_URL = process.env.NEXT_PUBLIC_ATHOS_URL ?? ""

type Cuerpo = {
  consultation_id?: unknown
  patient_id?: unknown
  transcript?: unknown
  motivo?: unknown
  modo?: unknown
}

export async function POST(req: Request) {
  if (!ATHOS_URL) {
    return NextResponse.json({ error: "El servicio de Athos no está configurado." }, { status: 503 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 })

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })
  const { clinicId } = sesion

  // El plan, antes que el tope: el Modo Fantasma en vivo es de Pro, igual que el resto de Athos.
  const conPlan = requiereCapacidad(sesion.plan, "athos")
  if (!conPlan.ok) {
    return NextResponse.json({ error: conPlan.mensaje }, {
      status: conPlan.status,
      headers: { "X-Requiere-Plan": "pro", "X-Capacidad": conPlan.capacidad },
    })
  }

  // EL TOPE MENSUAL. 402 y no 429: no se arregla reintentando.
  const presupuesto = await consultarPresupuesto(clinicId)
  if (!presupuesto.permitido) {
    return NextResponse.json({ error: mensajeSinCupo(presupuesto) }, { status: 402 })
  }

  const cuerpo = (await req.json().catch(() => ({}))) as Cuerpo
  const transcript = typeof cuerpo.transcript === "string" ? cuerpo.transcript : ""
  const consultationId = typeof cuerpo.consultation_id === "string" ? cuerpo.consultation_id : ""
  if (!transcript.trim() || !consultationId) {
    return NextResponse.json({ error: "Falta la consulta o el texto." }, { status: 400 })
  }

  // El token del vet se reenvía tal cual: el servicio verifica el JWT y resuelve la clínica solo.
  const { data: sesionSupabase } = await supabase.auth.getSession()
  const token = sesionSupabase.session?.access_token

  let res: Response
  try {
    res = await fetch(`${ATHOS_URL.replace(/\/$/, "")}/athos/live`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        clinic_id: clinicId,
        consultation_id: consultationId,
        patient_id: typeof cuerpo.patient_id === "string" ? cuerpo.patient_id : null,
        transcript,
        motivo: typeof cuerpo.motivo === "string" ? cuerpo.motivo : null,
        modo: cuerpo.modo === "sugerencias" ? "sugerencias" : "notas",
      }),
      signal: AbortSignal.timeout(25_000),
    })
  } catch {
    return NextResponse.json({ error: "El servicio de Athos no respondió." }, { status: 504 })
  }

  if (!res.ok) {
    return NextResponse.json({ error: `Athos respondió ${res.status}` }, { status: res.status })
  }

  const salida = (await res.json()) as {
    modelo?: string
    gasto?: boolean
  } & Record<string, unknown>

  // SE REGISTRA EL GASTO, NO LA RESPUESTA. `gasto` viene en true aunque el modelo haya dicho que no
  // había material: la llamada ocurrió y ya se pagó. Contar sólo lo que devuelve texto dejaría fuera
  // del presupuesto justo el caso más frecuente.
  //
  // Sin tokens: el servicio usa su propio cliente y `complete()` no los expone. `registrarUso`
  // guarda null antes que un 0, y el tope cuenta FILAS, así que el presupuesto no se ve afectado.
  if (salida.gasto) {
    const modelo = salida.modelo || "desconocido"
    void registrarUso({
      clinicId,
      userId: user.id,
      surface: "consulta_viva",
      elegido: {
        // `model` no se usa para registrar — sólo `modelId`, `provider` y `modeloPrimario`.
        model: null as never,
        modelId: modelo,
        provider: "athos-service",
        modeloPrimario: modelo,
      },
      usage: undefined,
    })
  }

  return NextResponse.json(salida)
}

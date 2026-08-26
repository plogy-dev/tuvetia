import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { clinicaDeLaSesion } from "@/lib/api/clinica-de-la-sesion"
import { rateLimit } from "@/lib/athos-agent/rate-limit"

export const runtime = "nodejs"

// Eliminar un chat DE LA VISTA (pedido del cliente, 26-ago): marca `hidden_at` en los mensajes del
// hilo — no borra NADA. Las filas quedan (trazabilidad) y la memoria del paciente ni se toca; el
// historial y la siembra del hilo filtran `hidden_at is null`. `restaurar` es el "Deshacer" del
// toast: vuelve a null y el chat reaparece tal cual.
//
// Va con service_role + clinic_id EXPLÍCITO de la sesión (patrón del repo para escrituras que la
// RLS del vet no cubre: athos_messages no tiene política de UPDATE para miembros, y agregarla solo
// para esto sería abrir más de lo que se necesita).

const BodySchema = z
  .object({
    accion: z.enum(["ocultar", "restaurar"]),
    patient_id: z.string().uuid().optional(),
    thread_key: z.string().min(1).max(64).optional(),
  })
  // Exactamente UNO de los dos: un hilo es de paciente o es general, nunca ambos.
  .refine((b) => Boolean(b.patient_id) !== Boolean(b.thread_key), {
    message: "se identifica el hilo con patient_id O con thread_key",
  })

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const rl = rateLimit(`athos-ocultar:${user.id}`, 30, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 })
  const { accion, patient_id, thread_key } = parsed.data

  const sesion = await clinicaDeLaSesion(supabase, user.id)
  if (!sesion.ok) return NextResponse.json({ error: sesion.mensaje }, { status: sesion.status })

  let q = createAdminClient()
    .from("athos_messages")
    .update({ hidden_at: accion === "ocultar" ? new Date().toISOString() : null })
    // service_role se salta la RLS: el filtro por la clínica DE LA SESIÓN es obligatorio — sin él,
    // un thread_key adivinado ocultaría chats ajenos.
    .eq("clinic_id", sesion.clinicId)
  q = patient_id ? q.eq("patient_id", patient_id) : q.eq("thread_key", thread_key)

  const { error } = await q
  if (error) {
    console.error("athos/chats/ocultar:", error.message)
    return NextResponse.json({ error: "No se pudo actualizar el chat." }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}

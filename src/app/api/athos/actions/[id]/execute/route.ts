import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { pushAppointment } from "@/lib/google-calendar"
import { validarPayload } from "@/lib/athos-agent/payload-schemas"
import { sendWhatsAppText } from "@/lib/whatsapp/send-message"

export const runtime = "nodejs"

// Ejecuta una acción propuesta por Athos, BAJO LA SESIÓN DEL VET que aprueba: las RPCs
// SECURITY DEFINER ven auth.uid() real y la RLS aplica — sin impersonación. El vet puede editar
// el payload antes de aprobar (payload_override). Toda transición queda en audit_logs.

type ActionRow = {
  id: string
  clinic_id: string
  status: string
  tool_name: string
  payload: Record<string, unknown>
  owner_id: string | null
  patient_id: string | null
  expires_at: string
}

/**
 * Copia la cita recien creada a Google Calendar. Devuelve el id del evento, o null si no se pudo.
 *
 * Nunca lanza: la cita YA esta creada en la plataforma cuando esto corre. Si el veterinario no
 * conecto Google, o la API responde mal, se registra y se sigue — romper la aprobacion de una accion
 * por una copia en un calendario externo seria desproporcionado.
 */
async function pushToGoogle(userId: string, appointmentId: unknown): Promise<string | null> {
  if (typeof appointmentId !== "string" || !appointmentId) return null
  try {
    return await pushAppointment(userId, appointmentId)
  } catch (e) {
    console.error("[athos/execute] no se pudo empujar la cita a Google Calendar:", e)
    return null
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  // La acción se lee con la SESIÓN (RLS de la clínica): si no es de su clínica, no existe.
  const { data: actionData } = await supabase
    .from("athos_actions")
    .select("id, clinic_id, status, tool_name, payload, owner_id, patient_id, expires_at")
    .eq("id", id)
    .maybeSingle()
  const action = actionData as ActionRow | null
  if (!action) return NextResponse.json({ error: "Acción no encontrada" }, { status: 404 })
  if (action.status !== "proposed")
    return NextResponse.json({ error: `La acción ya está en estado "${action.status}"` }, { status: 409 })
  if (new Date(action.expires_at).getTime() < Date.now()) {
    // Condicional también: si alguien la ejecutó justo ahora, no la pisamos con "expired".
    await claimAction(action.id, { status: "expired" })
    return NextResponse.json({ error: "La propuesta expiró — pídele a Athos una nueva" }, { status: 410 })
  }

  const body = (await req.json().catch(() => ({}))) as { payload_override?: Record<string, unknown> }
  // El vet puede editar la propuesta antes de aprobarla — esa es la intención. Pero entre proponer y
  // ejecutar el payload sale del servidor y vuelve, y nada volvía a mirarlo: se revalida contra el
  // esquema de lo que esa tool guarda. Además el parseo DESCARTA los campos desconocidos, así que un
  // `clinic_id` o un `vet_id` agregados al override no llegan a la RPC.
  const revision = validarPayload(action.tool_name, {
    ...action.payload,
    ...(body.payload_override ?? {}),
  })
  if (!revision.ok) return NextResponse.json({ error: revision.error }, { status: 400 })
  const payload = revision.payload

  // RESERVA ATÓMICA antes de despachar. El chequeo de status de arriba es un TOCTOU: entre leer
  // y ejecutar puede colarse otra request (doble clic en "Aprobar", reintento del navegador) y
  // ambas pasaban la validación → dos citas creadas, o dos WhatsApp al titular. El UPDATE
  // condicional deja que solo UNA transición proposed→approved gane; la perdedora ve 0 filas.
  const claimed = await claimAction(action.id, {
    status: "approved",
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  })
  if (!claimed) {
    return NextResponse.json(
      { error: "Esta propuesta ya fue procesada — recargá para ver en qué quedó" },
      { status: 409 },
    )
  }

  try {
    const result = await dispatch(supabase, user.id, action, payload)
    await markAction(action.id, {
      status: "executed",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      result: { ...result, executed_payload: payload },
    })
    await audit(action, user.id, "athos_action.executed", { tool_name: action.tool_name, result })
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    const msg = (e as Error).message
    await markAction(action.id, {
      status: "failed",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      error: msg,
    })
    await audit(action, user.id, "athos_action.failed", { tool_name: action.tool_name, error: msg })
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

async function dispatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  action: ActionRow,
  p: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (action.tool_name) {
    case "send_whatsapp_message": {
      const { waMessageId, message } = await sendWhatsAppText(
        action.clinic_id,
        String(p.to_phone ?? ""),
        String(p.body ?? ""),
        { ownerId: (p.owner_id as string | null) ?? action.owner_id, sentBy: userId, agentMode: "review" },
      )
      return { wa_message_id: waMessageId, message }
    }

    case "create_appointment": {
      const { data, error } = await supabase.rpc("create_appointment", {
        p_title: p.title,
        p_starts_at: p.starts_at,
        p_ends_at: p.ends_at,
        p_patient_id: p.patient_id ?? null,
        p_owner_id: p.owner_id ?? null,
        p_vet_id: userId,
        p_reason: p.reason ?? null,
        p_status: "scheduled",
        p_notes: p.notes ?? null,
      })
      if (error) throw new Error(`No se pudo crear la cita: ${error.message}`)
      const appointmentId = data as unknown
      // Empuja la cita a Google Calendar, igual que hace la pantalla de agenda al crearla a mano.
      // Sin esto, una cita hecha por el veterinario llegaba a Google y una hecha por Athos no —
      // el vet veía su agenda incompleta en el teléfono y no tenía forma de saber por qué.
      //
      // NO bloquea: si el veterinario no conectó Google, o la API falla, la cita YA está creada en la
      // plataforma y eso es lo que importa. Perder la copia en Google es recuperable con el botón
      // "Sincronizar"; perder la cita no.
      const googleEventId = await pushToGoogle(userId, appointmentId)
      return { appointment_id: appointmentId, google_event_id: googleEventId }
    }

    case "update_appointment": {
      // La RPC reemplaza todos los campos: cargar la cita actual (RLS) y mergear los cambios.
      const { data: current, error: curErr } = await supabase
        .from("appointments")
        .select("id, title, reason, status, starts_at, ends_at, patient_id, owner_id, vet_id, notes")
        .eq("id", String(p.appointment_id))
        .maybeSingle()
      if (curErr || !current) throw new Error("No se encontró la cita a modificar")
      const cur = current as {
        title: string; reason: string | null; status: string; starts_at: string; ends_at: string
        patient_id: string | null; owner_id: string | null; vet_id: string | null; notes: string | null
      }
      const durationMin =
        (p.duration_min as number | undefined) ??
        Math.round((new Date(cur.ends_at).getTime() - new Date(cur.starts_at).getTime()) / 60_000)
      let starts = cur.starts_at
      if (p.date || p.time) {
        const curLocal = new Date(new Date(cur.starts_at).getTime() - 5 * 3600_000)
        const date = (p.date as string | undefined) ?? curLocal.toISOString().slice(0, 10)
        const time =
          (p.time as string | undefined) ??
          `${String(curLocal.getUTCHours()).padStart(2, "0")}:${String(curLocal.getUTCMinutes()).padStart(2, "0")}`
        starts = `${date}T${time}:00-05:00`
      }
      const ends = new Date(new Date(starts).getTime() + durationMin * 60_000).toISOString()
      const { error } = await supabase.rpc("update_appointment", {
        p_id: p.appointment_id,
        p_title: (p.title as string | undefined) ?? cur.title,
        p_starts_at: starts,
        p_ends_at: ends,
        p_patient_id: cur.patient_id,
        p_owner_id: cur.owner_id,
        p_vet_id: cur.vet_id ?? userId,
        p_reason: p.reason !== undefined ? p.reason : cur.reason,
        p_status: (p.status as string | undefined) ?? cur.status,
        p_notes: p.notes !== undefined ? p.notes : cur.notes,
      })
      if (error) throw new Error(`No se pudo actualizar la cita: ${error.message}`)
      return { appointment_id: p.appointment_id as string }
    }

    case "create_owner": {
      const { data, error } = await supabase.rpc("create_owner", {
        p_full_name: p.full_name,
        p_phone: p.phone ?? null,
        p_email: p.email ?? null,
        p_document_id: p.document_id ?? null,
        p_address: p.address ?? null,
        p_notes: p.notes ?? null,
      })
      if (error) throw new Error(`No se pudo crear el titular: ${error.message}`)
      return { owner_id: data as unknown }
    }

    case "create_patient": {
      const { data, error } = await supabase.rpc("create_patient", {
        p_owner_id: p.owner_id,
        p_name: p.name,
        p_species: p.species,
        p_sex: p.sex ?? "unknown",
        p_breed: p.breed ?? null,
        p_birth_date: p.birth_date ?? null,
        p_weight_kg: p.weight_kg ?? null,
      })
      if (error) throw new Error(`No se pudo crear el paciente: ${error.message}`)
      return { patient_id: data as unknown }
    }

    case "create_owner_and_patient": {
      const owner = (p.owner ?? {}) as Record<string, unknown>
      const patient = (p.patient ?? {}) as Record<string, unknown>
      const { data: ownerId, error: oErr } = await supabase.rpc("create_owner", {
        p_full_name: owner.full_name,
        p_phone: owner.phone ?? null,
        p_email: owner.email ?? null,
        p_document_id: null,
        p_address: null,
        p_notes: null,
      })
      if (oErr) throw new Error(`No se pudo crear el titular: ${oErr.message}`)
      const { data: patientId, error: pErr } = await supabase.rpc("create_patient", {
        p_owner_id: ownerId,
        p_name: patient.name,
        p_species: patient.species,
        p_sex: patient.sex ?? "unknown",
        p_breed: patient.breed ?? null,
        p_birth_date: patient.birth_date ?? null,
        p_weight_kg: patient.weight_kg ?? null,
      })
      if (pErr) throw new Error(`Titular creado pero el paciente falló: ${pErr.message}`)
      return { owner_id: ownerId as unknown, patient_id: patientId as unknown }
    }

    case "update_patient_record": {
      const patientId = String(p.patient_id)
      const patch: Record<string, unknown> = {}
      if (p.weight_kg !== undefined && p.weight_kg !== null) patch.weight_kg = p.weight_kg
      if (p.notes_append) {
        const { data: cur } = await supabase.from("patients").select("notes").eq("id", patientId).maybeSingle()
        const existing = (cur as { notes: string | null } | null)?.notes
        patch.notes = existing ? `${existing}\n${String(p.notes_append)}` : String(p.notes_append)
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("patients").update(patch).eq("id", patientId)
        if (error) throw new Error(`No se pudo actualizar la ficha: ${error.message}`)
      }
      const allergy = p.add_allergy as { allergen: string; severity: string; reaction?: string | null } | undefined
      if (allergy?.allergen) {
        const { error } = await supabase.from("allergies").insert({
          clinic_id: action.clinic_id,
          patient_id: patientId,
          allergen: allergy.allergen,
          severity: allergy.severity,
          reaction: allergy.reaction ?? null,
          created_by: userId,
        })
        if (error) throw new Error(`Ficha actualizada pero la alergia falló: ${error.message}`)
      }
      return { patient_id: patientId, updated: Object.keys(patch), allergy_added: Boolean(allergy?.allergen) }
    }

    default:
      throw new Error(`Tool desconocida: ${action.tool_name}`)
  }
}

/**
 * Transición condicional desde 'proposed' (compare-and-set).
 *
 * El UPDATE lleva `.eq("status", "proposed")`, así que si dos requests compiten por la misma
 * propuesta solo una encuentra la fila en ese estado: la otra recibe 0 filas y devuelve false.
 * Es la reserva que hace segura la ejecución — sin esto, ambas despachaban.
 *
 * Devuelve true si esta request se quedó con la acción.
 */
async function claimAction(id: string, patch: Record<string, unknown>): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("athos_actions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "proposed")
    .select("id")
  return (data ?? []).length > 0
}

/** Transición incondicional. Solo se usa DESPUÉS de haber ganado la reserva. */
async function markAction(id: string, patch: Record<string, unknown>) {
  const admin = createAdminClient()
  await admin
    .from("athos_actions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
}

async function audit(action: ActionRow, userId: string, kind: string, payload: Record<string, unknown>) {
  const admin = createAdminClient()
  await admin.from("audit_logs").insert({
    clinic_id: action.clinic_id,
    user_id: userId,
    action: kind,
    table_name: "athos_actions",
    record_id: action.id,
    payload,
  })
}

import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { empujarCita } from "@/lib/composio/calendario"
import { validarPayload } from "@/lib/athos-agent/payload-schemas"
import { sendWhatsAppText } from "@/lib/whatsapp/send-message"
import {
  clasificarFalloDeEnvio,
  ErrorQueElVetPuedeResolver,
  FALLO_DE_ACCION,
} from "@/lib/whatsapp/error-de-envio"
import {
  avisoDeEntrega,
  enviarCorreo,
  estadoConexion,
  responderCorreo,
  verificarDestinatarioDeRespuesta,
} from "@/lib/composio/correo"

export const runtime = "nodejs"

/**
 * Desde qué dirección salió el correo, y si esa dirección puede entregar.
 *
 * "Enviado" a secas no alcanzaba: el proveedor acepta el envío, lo guarda en Enviados y responde
 * éxito aunque la dirección no pueda autenticarse y el correo termine descartado. Pasó de verdad —
 * una cuenta de Microsoft registrada con un correo `@gmail.com`— y desde el chat era indistinguible
 * de un envío que llegó. Dejar constancia del remitente hace que quede rastro de qué salió y de
 * dónde, en vez de un "listo" que no se puede verificar.
 */
async function desdeDonde(userId: string): Promise<{ remitente: string | null; aviso?: string }> {
  const { proveedor, email } = await estadoConexion(userId)
  const aviso = proveedor ? avisoDeEntrega(proveedor, email) : null
  return { remitente: email, ...(aviso ? { aviso } : {}) }
}

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
 * Copia la cita recien creada al Google Calendar del ADMIN de la clínica. Devuelve el id del
 * evento, o null si no se pudo.
 *
 * Nunca lanza: la cita YA esta creada en la plataforma cuando esto corre. Si el admin no conecto
 * Google, o la API responde mal, se registra y se sigue — romper la aprobacion de una accion
 * por una copia en un calendario externo seria desproporcionado.
 */
async function pushToGoogle(
  appointmentId: unknown,
): Promise<{ googleEventId: string | null; aviso: string | null }> {
  if (typeof appointmentId !== "string" || !appointmentId)
    return { googleEventId: null, aviso: null }
  try {
    const { eventId, motivo } = await empujarCita(appointmentId)
    if (eventId) return { googleEventId: eventId, aviso: null }
    // `empujarCita` devuelve null cuando el VETERINARIO ASIGNADO no conectó su calendario (el
    // calendario es de cada vet desde la migración 0049, no de la clínica). No es un fallo, pero
    // el vet TIENE que enterarse: si no, la cita no aparece en su calendario y no hay forma de
    // saber por qué. Pasó en producción el 30-jul y fue exactamente esa la pregunta.
    return {
      googleEventId: null,
      aviso:
        motivo === "sin-administrador"
          ? "La cita quedó en la agenda de la plataforma. No se copió a ningún calendario porque la clínica no tiene administrador asignado."
          : "La cita quedó en la agenda de la plataforma. No se copió al calendario porque el administrador de la clínica no conectó el suyo en Conexiones.",
    }
  } catch (e) {
    console.error("[athos/execute] no se pudo empujar la cita a Google Calendar:", e)
    return {
      googleEventId: null,
      aviso: "La cita quedó en la agenda de la plataforma, pero no se pudo copiar a Google Calendar.",
    }
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
    // El detalle CRUDO se guarda y se audita: es lo que hace depurable una propuesta fallida.
    //
    // `detalle` gana cuando existe: en los fallos A MEDIAS el `message` es el texto escrito para el
    // vet ("el titular sí se creó"), y el error de Postgres que hace depurable el caso viaja
    // aparte. Sin esto, hacer legible el mensaje habría borrado el rastro.
    const msg =
      e instanceof ErrorQueElVetPuedeResolver && e.detalle ? e.detalle : (e as Error).message
    await markAction(action.id, {
      status: "failed",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      error: msg,
    })
    await audit(action, user.id, "athos_action.failed", { tool_name: action.tool_name, error: msg })

    // Al vet, en cambio, la CLASE del fallo. Antes se le devolvía `msg` tal cual, y el 2026-08-03 eso
    // le puso en pantalla la respuesta entera del proveedor —ruta interna y nombre de la instancia,
    // que es el id de la clínica— dentro de un toast. La bandeja ya no lo hacía; este camino sí,
    // porque el clasificador se agregó sólo en /api/whatsapp/send.
    // El clasificador nació para los envíos de WhatsApp y acá se aplica a las NUEVE tools. Con el
    // contexto por defecto, fallar creando un paciente le decía al vet "no se pudo ENVIAR EL
    // MENSAJE" y lo mandaba a revisar la conexión de WhatsApp. Las tools que sí mandan algo afuera
    // conservan ese texto, que para ellas es el correcto.
    const fallo = clasificarFalloDeEnvio(e, ENVIA_AFUERA.has(action.tool_name) ? undefined : FALLO_DE_ACCION)
    return NextResponse.json({ error: fallo.texto }, { status: fallo.status })
  }
}

/**
 * Las tools cuyo efecto es mandarle algo a alguien por un proveedor externo. Son las únicas para
 * las que "no se pudo enviar el mensaje / revisá la conexión" es el texto correcto ante un fallo.
 */
const ENVIA_AFUERA = new Set(["send_whatsapp_message", "send_email", "reply_email"])

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

    case "send_email": {
      // Sale de la cuenta del vet que APRUEBA: el correo lo firma una persona y el titular tiene
      // que poder responderle a ella. Athos nunca escribe desde la cuenta de otro.
      const r = await enviarCorreo(userId, {
        a: String(p.to_email ?? ""),
        asunto: String(p.subject ?? ""),
        cuerpo: String(p.body ?? ""),
      })
      if (!r.ok) throw new Error(r.error)
      return { enviado: true, ...(await desdeDonde(userId)) }
    }

    case "reply_email": {
const threadId = String(p.thread_id ?? "")
      const destinatario = String(p.to_email ?? "")

      // EL DESTINATARIO SE VERIFICA CONTRA EL HILO, ANTES DE ENVIAR.
      //
      // El modelo propone `to_email` y la tarjeta deja editarlo, así que un correo entrante con
      // instrucciones inyectadas podría lograr que la respuesta salga a otra dirección. Ver el
      // detalle en `verificarDestinatarioDeRespuesta`, que además sabe cuándo NO hace falta: con
      // Outlook el destinatario lo fija el proveedor y no hay nada que redirigir.
      const permitido = await verificarDestinatarioDeRespuesta(userId, threadId, destinatario)
      if (!permitido.ok) throw new Error(permitido.error)

      // La referencia es lo que hace que la respuesta quede DENTRO de la conversación: el hilo en
      // Gmail, el mensaje en Outlook. `responderCorreo` elige la tool según el proveedor conectado.
      const r = await responderCorreo(userId, {
        ref: threadId,
        a: destinatario,
        asunto: String(p.subject ?? ""),
        cuerpo: String(p.body ?? ""),
      })
      if (!r.ok) throw new Error(r.error)
      return { enviado: true, thread_id: threadId, ...(await desdeDonde(userId)) }
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
      const { googleEventId, aviso } = await pushToGoogle(appointmentId)
      return {
        appointment_id: appointmentId,
        google_event_id: googleEventId,
        ...(aviso ? { aviso, aviso_enlace: "/dashboard/calendario" } : {}),
      }
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
      // FALLO A MEDIAS: el titular YA quedó creado. Decírselo al vet no es cortesía — sin eso
      // vuelve a aprobar la propuesta y termina con el titular duplicado, que después hay que
      // deduplicar a mano. El error de Postgres viaja en `detalle` y sigue quedando en la auditoría.
      if (pErr)
        throw new ErrorQueElVetPuedeResolver(
          "El titular se creó, pero el paciente no. Agregá el paciente desde la ficha del titular: si volvés a aprobar esta propuesta, el titular queda duplicado.",
          409,
          `Titular creado pero el paciente falló: ${pErr.message}`,
        )
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
        // El otro fallo a medias, y el más delicado de los dos: peso y notas ya se guardaron, pero
        // LA ALERGIA NO. Que el vet crea que quedó registrada es justo lo que desarma el gate de
        // alergia severa en la próxima consulta.
        if (error)
          throw new ErrorQueElVetPuedeResolver(
            "La ficha se actualizó, pero la ALERGIA no quedó registrada. Cargala a mano en la ficha del paciente antes de seguir: el aviso de alergia no va a aparecer hasta que esté.",
            409,
            `Ficha actualizada pero la alergia falló: ${error.message}`,
          )
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

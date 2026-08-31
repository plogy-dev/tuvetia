import "server-only"

// El nivel 3 de la barra de autonomía: VetGPT agenda la cita y la confirma sin que un vet apruebe.
//
// ── LO QUE HACE FALTA ENTENDER ANTES DE TOCAR ESTO ────────────────────────────────────────────
//
// Este es el ÚNICO camino del producto que crea un titular, un paciente y una cita sin que ninguna
// persona haya mirado. Todo lo demás en VetGPT propone y espera. La regla que lo hace defendible es
// que la clínica lo tiene que encender a mano —`confirma_citas_solo`, tercer nivel de la barra— y
// que hasta ese momento el comportamiento es exactamente el de siempre.
//
// LA FILA `proposed` SE CREA IGUAL Y DESPUÉS SE MARCA `executed`. No se saltea: es la traza de qué
// hizo el agente y con qué datos, y es lo que la bandeja ya sabe pintar. Sin ella, una cita nacida
// acá sería indistinguible de una cargada a mano y nadie podría auditar el nivel 3.
//
// FALLA HACIA LA BANDEJA. Si algo sale mal —no hay vet, la base rechaza, el teléfono no está— la
// acción se queda `proposed` y la atiende una persona, que es el comportamiento del nivel 2. Un
// nivel 3 que falle en silencio sería el mismo defecto que esta tanda vino a arreglar.

import type { SupabaseClient } from "@supabase/supabase-js"

import { confirmarCita } from "@/lib/citas/confirmacion"

type SB = SupabaseClient

/**
 * A quién se le cuelga una cita que nadie asignó.
 *
 * `create_appointment` exige un vet siempre, y en este camino no hay ninguno «eligiendo». El
 * suplente correcto es el administrador de la clínica — el mismo respaldo que ya usa el empuje al
 * calendario cuando el vet asignado no conectó el suyo. Primero `clinics.owner_id`; si esa columna
 * está vacía (clínicas viejas), el primer perfil con rol de administrador.
 *
 * `null` = esta clínica no tiene a quién asignarle nada, y entonces NO se auto-agenda.
 */
export async function vetDeRespaldo(admin: SB, clinicId: string): Promise<string | null> {
  const { data: clinica } = await admin
    .from("clinics")
    .select("owner_id")
    .eq("id", clinicId)
    .maybeSingle()
  const dueno = (clinica as { owner_id: string | null } | null)?.owner_id
  if (dueno) return dueno

  const { data: perfil } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle()
  return (perfil as { id: string } | null)?.id ?? null
}

export type ResultadoDeAgendarSolo =
  | { agendada: true; appointmentId: string; avisada: boolean }
  | { agendada: false; motivo: string }

/**
 * Ejecuta una solicitud de cita sin aprobación humana, y avisa al titular.
 *
 * `actionId` es la fila `proposed` que `solicitar_cita` acaba de crear: si esto sale bien se marca
 * `executed` con el resultado, y si sale mal se deja como está para que la atienda un vet.
 */
export async function agendarYConfirmarSolo(
  admin: SB,
  input: {
    actionId: string
    clinicId: string
    nombre: string
    telefono: string
    email: string | null
    mascota: string
    especie: string
    startsAt: string
    endsAt: string
    reason: string
    sinHora: boolean
  },
): Promise<ResultadoDeAgendarSolo> {
  try {
    const vetId = await vetDeRespaldo(admin, input.clinicId)
    if (!vetId) {
      // Decirlo en voz alta y no seguir: sin vet la cita no se puede crear, y dejarla `proposed` es
      // exactamente lo que hay que hacer — el nivel 3 degrada al 2 para esta clínica.
      console.warn(
        `[wa/agendar-solo] la clínica ${input.clinicId} no tiene administrador: la cita queda para aprobar a mano.`,
      )
      return { agendada: false, motivo: "sin_vet_de_respaldo" }
    }

    // Una sola llamada, una sola transacción: si la cita falla, el titular y el paciente se van con
    // ella. El porqué está en la migración 0102.
    const { data, error } = await admin.rpc("agendar_desde_whatsapp", {
      p_clinic_id: input.clinicId,
      p_vet_id: vetId,
      p_nombre: input.nombre,
      p_telefono: input.telefono,
      p_email: input.email,
      p_mascota: input.mascota,
      p_especie: input.especie,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_reason: input.reason,
      p_sin_hora: input.sinHora,
    })
    if (error) {
      console.error("[wa/agendar-solo] no se pudo agendar:", error.message)
      return { agendada: false, motivo: error.message }
    }

    const creado = data as { owner_id: string; patient_id: string; appointment_id: string }

    // ── EL AVISO AL TITULAR ─────────────────────────────────────────────────────────────────────
    //
    // `confirmarCita` ya arma el mensaje con los enlaces de Calendar y Maps, y ya respeta el
    // interruptor `clinics.confirmacion_citas_activo`. No se duplica nada acá.
    //
    // OJO CON UNA COSA QUE NO ES OBVIA: ese mensaje sale por `sendWhatsAppText` sin escribir fila en
    // `athos_actions`, así que NO consume el cupo diario ni el anti-loop de 8/hora. Es defendible
    // —es transaccional, igual que los avisos de cartera— pero conviene que sea una decisión y no un
    // descubrimiento: si algún día el nivel 3 se usa a gran escala, hay que volver acá.
    const aviso = await confirmarCita(creado.appointment_id, input.clinicId)
    if (!aviso.ok) {
      console.warn(`[wa/agendar-solo] la cita quedó agendada pero no se avisó: ${aviso.motivo}`)
    }

    await admin
      .from("athos_actions")
      .update({
        status: "executed",
        executed_at: new Date().toISOString(),
        result: { ...creado, confirmacion_enviada: aviso.ok, motivo_del_aviso: aviso.motivo },
      })
      .eq("id", input.actionId)

    await admin.from("audit_logs").insert({
      clinic_id: input.clinicId,
      // Acción propia y no `athos_action.executed`: la diferencia entre «un vet aprobó» y «nadie
      // miró» es justo lo que se va a querer buscar el día que haya que revisar el nivel 3.
      action: "athos_action.auto_confirmada",
      table_name: "athos_actions",
      record_id: input.actionId,
      payload: { ...creado, vet_de_respaldo: vetId, confirmacion_enviada: aviso.ok },
    })

    return { agendada: true, appointmentId: creado.appointment_id, avisada: aviso.ok }
  } catch (e) {
    console.error("[wa/agendar-solo]", e)
    return { agendada: false, motivo: (e as Error).message }
  }
}

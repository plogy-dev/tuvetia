import "server-only"

import { bloqueDeLinks } from "@/lib/citas/links"

// El barrido que manda los recordatorios de cita.
//
// ── DÓNDE CORRE, Y POR QUÉ AHÍ ────────────────────────────────────────────────────────────────
//
// Cuelga del cron de cartera (`/api/cron/cartera`, 9 a. m. Colombia). NO tiene cron propio: el plan
// de Vercel da DOS crons diarios y los dos ya están usados —`purge-audio` a las 3 y cartera a las
// 9—. Colgarlo de cartera no es un apaño: las 9 de la mañana es buena hora para avisar «mañana a
// las 10», y compartir la corrida significa que si el cron falla, falla una cosa y no dos por
// separado.
//
// ── NO ES COBRANZA, Y ESO CAMBIA LAS REGLAS ───────────────────────────────────────────────────
//
// Las ventanas de la Ley 2300 que respeta cartera son de COBRANZA: cuántas veces por semana se
// puede perseguir a alguien por una deuda. Un recordatorio de cita es un mensaje TRANSACCIONAL del
// servicio que el titular contrató —no cae bajo esa restricción— pero sí bajo la Ley 1581 de datos.
//
// Por eso este barrido NO reusa el despachador de cartera ni su outbox: son dos regímenes
// distintos, y mezclarlos haría que un cambio en las reglas de cobranza moviera sin querer los
// avisos de cita. Comparten el puerto de SALIDA (`sendWhatsAppText`) y nada más.
//
// ── EXACTAMENTE UNA VEZ ───────────────────────────────────────────────────────────────────────
//
// `appointments.recordatorio_enviado_en` se sella ANTES de mandar, no después. Un cron se
// reintenta —Vercel reintenta, y alguien puede correrlo a mano— y el peor caso tiene que ser «no
// llegó» y no «llegó tres veces»: lo primero se nota y se arregla, lo segundo molesta al titular y,
// repetido, es exactamente lo que la Ley 2300 vino a frenar en el otro régimen.
//
// El costo de sellar antes es que un fallo de envío deja la cita marcada sin haber avisado. Es el
// intercambio correcto acá, y queda registrado en el log.

import { createAdminClient } from "@/lib/supabase/admin"
import { sendWhatsAppText } from "@/lib/whatsapp/send-message"
import {
  ESTADOS_QUE_SE_AVISAN,
  TEXTO_POR_DEFECTO,
  diaAAvisar,
  fechaYHora,
  llenarTexto,
} from "./recordatorio"

type CitaAAvisar = {
  id: string
  starts_at: string
  patient: { name: string } | null
  owner: { full_name: string; phone: string | null } | null
}

export type ResultadoDelBarrido = {
  clinica: string
  dia: string
  candidatas: number
  enviados: number
  sinTelefono: number
  fallidos: number
}

/**
 * Manda los recordatorios que le tocan HOY a una clínica.
 *
 * Devuelve el recuento en vez de lanzar: lo llama un cron que atiende a varias clínicas, y que una
 * se caiga no puede dejar a las demás sin avisar.
 */
export async function barrerRecordatoriosDeCita(
  clinicId: string,
  nombreDeLaClinica: string,
  opciones: { activo: boolean; horas: number; texto?: string | null; direccion?: string | null },
  ahora = new Date(),
): Promise<ResultadoDelBarrido> {
  const dia = diaAAvisar(opciones.horas, ahora)
  const vacio: ResultadoDelBarrido = {
    clinica: nombreDeLaClinica,
    dia,
    candidatas: 0,
    enviados: 0,
    sinTelefono: 0,
    fallidos: 0,
  }
  if (!opciones.activo) return vacio

  const admin = createAdminClient()
  const texto = opciones.texto?.trim() || TEXTO_POR_DEFECTO

  // El día en hora de Bogotá, de punta a punta. `-05:00` explícito: Colombia no cambia de hora, y
  // dejarlo en UTC correría la ventana cinco horas — se colarían las citas de la madrugada del día
  // siguiente y se perderían las de la noche del día objetivo.
  const { data, error } = await admin
    .from("appointments")
    .select(
      "id, starts_at, patient:patients!appointments_patient_id_fkey(name), owner:owners!appointments_owner_id_fkey(full_name, phone)",
    )
    .eq("clinic_id", clinicId)
    .gte("starts_at", `${dia}T00:00:00-05:00`)
    .lte("starts_at", `${dia}T23:59:59-05:00`)
    .in("status", ESTADOS_QUE_SE_AVISAN)
    .is("recordatorio_enviado_en", null)
    .not("owner_id", "is", null)
    .order("starts_at", { ascending: true })
    .limit(200)

  if (error) {
    console.error(`recordatorio de citas · ${nombreDeLaClinica}:`, error.message)
    return vacio
  }

  const citas = (data as unknown as CitaAAvisar[] | null) ?? []
  const res = { ...vacio, candidatas: citas.length }

  for (const cita of citas) {
    const telefono = cita.owner?.phone?.trim()
    if (!telefono) {
      // Sin teléfono no hay a dónde mandar. NO se sella: si mañana le cargan el número, que le
      // llegue — a diferencia de un fallo de envío, acá no se intentó nada.
      res.sinTelefono += 1
      continue
    }

    const { fecha, hora } = fechaYHora(cita.starts_at)
    // Sólo «cómo llegar» (28-ago): agregar al calendario una cita de MAÑANA a último momento no
    // aporta, y el recordatorio corto se lee mejor. El link de Calendar va en la confirmación.
    const cuerpo =
      llenarTexto(texto, {
        paciente: cita.patient?.name ?? "su mascota",
        fecha,
        hora,
        clinica: nombreDeLaClinica,
      }) +
      bloqueDeLinks({
        conCalendario: false,
        titulo: `Cita de ${cita.patient?.name ?? "su mascota"}`,
        inicio: cita.starts_at,
        direccion: opciones.direccion,
      })

    // Se sella ANTES de mandar. Ver el comentario de arriba: el peor caso tiene que ser «no llegó».
    const { error: sellarErr } = await admin
      .from("appointments")
      .update({ recordatorio_enviado_en: ahora.toISOString() })
      .eq("id", cita.id)
      .is("recordatorio_enviado_en", null)
    if (sellarErr) {
      console.error(`recordatorio de citas · sellar ${cita.id}:`, sellarErr.message)
      res.fallidos += 1
      continue
    }

    try {
      await sendWhatsAppText(clinicId, telefono, cuerpo)
      res.enviados += 1
    } catch (e) {
      // Queda sellada y sin avisar: es el intercambio elegido, y por eso se loguea con el id.
      console.error(`recordatorio de citas · envío ${cita.id}:`, (e as Error).message)
      res.fallidos += 1
    }
  }

  return res
}

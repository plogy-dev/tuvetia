import "server-only"

// Trae de la base lo que las señales necesitan. El QUÉ significa cada cosa vive en `pendientes.ts`,
// que es puro y testeable; acá sólo están las consultas.
//
// UNA SOLA FUENTE PARA LOS DOS CONSUMIDORES. Las señales se muestran en el riel de la clínica y
// entran al prompt del agente. Si cada uno hiciera sus propias consultas, el riel podría decir "3
// notas sin aprobar" mientras Athos afirma que hay dos — y esa clase de desacuerdo entre lo que la
// pantalla dice y lo que el asistente dice es peor que no mostrar nada.
//
// COSTE: cero IA. Son cuatro consultas, todas en paralelo, y tres de ellas son `count` con
// `head: true` — o sea que la base devuelve un número y ninguna fila.

import type { SupabaseClient } from "@supabase/supabase-js"

import { pendientesDeLaClinica, type MensajeParaSenal, type Pendiente } from "@/lib/senales/pendientes"

/**
 * Cuántos mensajes se miran hacia atrás para decidir quién quedó sin respuesta.
 *
 * Es un tope, no un filtro de tiempo: una conversación que quedó colgada hace dos meses ya no es un
 * pendiente accionable, y traer el historial entero de una clínica activa en cada render sería
 * pagar mucho por una señal que sólo necesita el ÚLTIMO mensaje de cada titular.
 */
const MENSAJES_A_MIRAR = 400

export type SenalesDeLaClinica = {
  pendientes: Pendiente[]
  /** Para el riel, que ya los mostraba antes de que esto existiera. */
  cobrosVencidos: { cuantas: number; totalCents: number }
}

/**
 * Las señales de una clínica.
 *
 * FALLA HACIA EL SILENCIO: si una consulta se cae, esa señal no aparece y las demás sí. Es el mismo
 * criterio que el resto del repo —el presupuesto de IA, el juez de evidencia— y acá es más claro
 * todavía: un riel al que le falta una línea es molesto; uno que rompe la pantalla de inicio porque
 * `vaccines` no respondió es inaceptable.
 */
export async function senalesDeLaClinica(
  supabase: SupabaseClient,
  clinicId: string,
  hoyISO: string,
): Promise<SenalesDeLaClinica> {
  const limiteVacunas = new Date(`${hoyISO}T00:00:00-05:00`)
  limiteVacunas.setUTCDate(limiteVacunas.getUTCDate() + 30)

  const [notas, mensajes, vacunas, tareas, facturas] = await Promise.all([
    supabase
      .from("clinical_notes")
      .select("status")
      .eq("clinic_id", clinicId)
      .eq("status", "draft")
      .then((r) => (r.error ? [] : ((r.data ?? []) as { status: string }[]))),

    supabase
      .from("whatsapp_messages")
      .select("owner_id, direction, created_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })
      .limit(MENSAJES_A_MIRAR)
      .then((r) => (r.error ? [] : ((r.data ?? []) as MensajeParaSenal[]))),

    supabase
      .from("vaccines")
      .select("next_dose_at")
      .eq("clinic_id", clinicId)
      .not("next_dose_at", "is", null)
      .lte("next_dose_at", limiteVacunas.toISOString().slice(0, 10))
      .then((r) => (r.error ? [] : ((r.data ?? []) as { next_dose_at: string | null }[]))),

    supabase
      .from("human_tasks")
      .select("status")
      .eq("clinic_id", clinicId)
      .eq("status", "open")
      .then((r) => (r.error ? [] : ((r.data ?? []) as { status: string }[]))),

    // Las vencidas se calculan acá y no en SQL porque el "hoy" es el de BOGOTÁ, no el del servidor:
    // con `due_date < now()` en UTC, una factura que vence hoy aparecería vencida desde las 19:00
    // del día anterior. Mismo criterio que `finDelDiaBogota` en facturación.
    supabase
      .from("invoices")
      .select("balance_cents, due_date")
      .eq("clinic_id", clinicId)
      .eq("status", "EMITIDA")
      .gt("balance_cents", 0)
      .then((r) =>
        r.error ? [] : ((r.data ?? []) as { balance_cents: number | null; due_date: string | null }[]),
      ),
  ])

  const vencidas = facturas.filter((f) => (f.balance_cents ?? 0) > 0 && f.due_date && f.due_date < hoyISO)
  const cobros = {
    cuantas: vencidas.length,
    totalCents: vencidas.reduce((s, f) => s + (f.balance_cents ?? 0), 0),
  }

  return {
    pendientes: pendientesDeLaClinica({ hoyISO, notas, mensajes, vacunas, tareas, cobros }),
    cobrosVencidos: cobros,
  }
}

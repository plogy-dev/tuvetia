import "server-only"
import {
  EMBED_DE_FACTURAS,
  TOPE_SIN_FACTURAR,
  desdeCuando,
  soloSinFacturar,
} from "@/lib/facturacion/sin-facturar"

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

import {
  pendientesDeLaClinica,
  type IntegracionParaSenal,
  type MensajeParaSenal,
  type Pendiente,
} from "@/lib/senales/pendientes"

/**
 * Cuántos mensajes se miran hacia atrás para decidir quién quedó sin respuesta.
 *
 * Es un tope, no un filtro de tiempo: una conversación que quedó colgada hace dos meses ya no es un
 * pendiente accionable, y traer el historial entero de una clínica activa en cada render sería
 * pagar mucho por una señal que sólo necesita el ÚLTIMO mensaje de cada titular.
 */
const MENSAJES_A_MIRAR = 400

/** Qué señales no se pudieron leer en esta pasada. Vacío = todas respondieron. */
export type SenalesCaidas = string[]

/**
 * Degrada a `[]` como antes, pero DEJANDO RASTRO.
 *
 * El silencio puro ya costó caro: el 2026-08-16, en el primer disparo real del briefing, dos
 * clínicas con notas pendientes se saltaron como "nada que contar" y no hubo forma de saber por
 * qué — el error existió y se descartó sin registrarlo. Con dos consultas a la base no se podía
 * distinguir "esta clínica está al día" de "la consulta se cayó".
 *
 * La degradación SIGUE SIENDO LA CORRECTA: un riel al que le falta una línea es mejor que una
 * pantalla de inicio rota. Lo que cambia es que ahora se sabe.
 */
function oVacio<T>(tabla: string, clinicId: string, caidas: SenalesCaidas) {
  return (r: { data: unknown; error: { message: string } | null }): T[] => {
    if (r.error) {
      console.error(`[senales] ${tabla} no respondió para la clínica ${clinicId}: ${r.error.message}`)
      caidas.push(tabla)
      return []
    }
    return (r.data ?? []) as T[]
  }
}

export type SenalesDeLaClinica = {
  pendientes: Pendiente[]
  /** Para el riel, que ya los mostraba antes de que esto existiera. */
  cobrosVencidos: { cuantas: number; totalCents: number }
  /**
   * Qué consultas fallaron. Vacío en el caso normal.
   *
   * Existe para que el LLAMADOR pueda distinguir "no hay nada pendiente" de "no pude averiguarlo",
   * que es exactamente lo que faltaba cuando el briefing se saltó dos clínicas sin explicación.
   */
  caidas: SenalesCaidas
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

  const caidas: SenalesCaidas = []

  const [notas, mensajes, vacunas, tareas, facturas, integraciones, sinFacturarRows] = await Promise.all([
    supabase
      .from("clinical_notes")
      .select("status")
      .eq("clinic_id", clinicId)
      .eq("status", "draft")
      .then(oVacio<{ status: string }>("clinical_notes", clinicId, caidas)),

    supabase
      .from("whatsapp_messages")
      .select("owner_id, direction, created_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })
      .limit(MENSAJES_A_MIRAR)
      .then(oVacio<MensajeParaSenal>("whatsapp_messages", clinicId, caidas)),

    supabase
      .from("vaccines")
      .select("next_dose_at")
      .eq("clinic_id", clinicId)
      .not("next_dose_at", "is", null)
      .lte("next_dose_at", limiteVacunas.toISOString().slice(0, 10))
      .then(oVacio<{ next_dose_at: string | null }>("vaccines", clinicId, caidas)),

    supabase
      .from("human_tasks")
      .select("status")
      .eq("clinic_id", clinicId)
      .eq("status", "open")
      .then(oVacio<{ status: string }>("human_tasks", clinicId, caidas)),

    // Las vencidas se calculan acá y no en SQL porque el "hoy" es el de BOGOTÁ, no el del servidor:
    // con `due_date < now()` en UTC, una factura que vence hoy aparecería vencida desde las 19:00
    // del día anterior. Mismo criterio que `finDelDiaBogota` en facturación.
    supabase
      .from("invoices")
      .select("balance_cents, due_date")
      .eq("clinic_id", clinicId)
      .eq("status", "EMITIDA")
      .gt("balance_cents", 0)
      .then(oVacio<{ balance_cents: number | null; due_date: string | null }>("invoices", clinicId, caidas)),

    // El estado VIVO del canal, que es lo único de esta tanda que no cuenta trabajo sino que informa
    // si el canal por el que ese trabajo se hace sigue en pie. Ver `canalCaido` en `pendientes.ts`.
    supabase
      .from("whatsapp_integrations")
      .select("status, updated_at")
      .eq("clinic_id", clinicId)
      .then(oVacio<IntegracionParaSenal>("whatsapp_integrations", clinicId, caidas)),

    // CONSULTAS TERMINADAS SIN FACTURA. El embed `invoices(id, status)` viene con `!left` explícito
    // porque lo que interesa son justamente las que NO tienen ninguna — un embed normal las dejaría
    // fuera. El filtro de "sin factura" se hace acá abajo, no en SQL: PostgREST no sabe expresar
    // "el embed vacío" en un `.is()` sin volverse ilegible.
    //
    // La ventana de 60 días es la misma que usa `getUnbilledConsultations`. Sin ella, una clínica
    // que empieza a facturar hoy arrastraría un año de consultas viejas al riel el primer día.
    supabase
      .from("consultations")
      .select(`id, ${EMBED_DE_FACTURAS}`)
      .eq("clinic_id", clinicId)
      .eq("status", "completed")
      .gte("started_at", desdeCuando(hoyISO))
      .limit(TOPE_SIN_FACTURAR)
      .then(
        oVacio<{ id: string; invoices: { id: string; status: string }[] | null }>(
          "consultations",
          clinicId,
          caidas,
        ),
      ),
  ])

  // SIN FACTURA = sin ninguna que siga en pie. Una ANULADA no cuenta como facturada, y esto no es
  // un detalle: `getUnbilledConsultations` —la lista de Ventas a la que este número manda— la
  // descarta con `.neq('status','ANULADA')`, porque anular una factura deja la consulta otra vez
  // por cobrar. Si acá se contara, el riel escondería la consulta justo cuando hay que volver a
  // emitirla, y el número dejaría de cuadrar con la lista que el vet abre a continuación.
  const sinFactura = soloSinFacturar(sinFacturarRows)

  const vencidas = facturas.filter((f) => (f.balance_cents ?? 0) > 0 && f.due_date && f.due_date < hoyISO)
  const cobros = {
    cuantas: vencidas.length,
    totalCents: vencidas.reduce((s, f) => s + (f.balance_cents ?? 0), 0),
  }

  return {
    pendientes: pendientesDeLaClinica({
      hoyISO,
      notas,
      mensajes,
      vacunas,
      tareas,
      cobros,
      integraciones,
      sinFacturar: sinFactura,
    }),
    cobrosVencidos: cobros,
    caidas,
  }
}

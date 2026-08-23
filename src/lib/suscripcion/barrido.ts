import "server-only"

// El barrido diario: cobra lo que vence, reintenta lo que falló, y baja lo que se canceló o se le
// terminó la prueba.
//
// UNA SOLA COLUMNA LO GOBIERNA: `clinics.plan_renueva_en`. Es "cuándo hay que volver a mirar esta
// clínica", y significa cosas distintas según el estado —renovar, reintentar, o bajar el plan—
// pero el barrido pregunta siempre lo mismo: ¿ya venció? Eso deja la consulta en una línea y hace
// que no exista ninguna clínica que el barrido pueda no ver.
//
// CORRE DE MÁS SIN CONSECUENCIAS. Es idempotente por la referencia del cobro: si se dispara dos
// veces el mismo día, el segundo intento choca contra el `unique` y no cobra. Por eso puede correr
// desde GitHub Actions —que no tiene SLA y a veces dispara tarde o dos veces— sin ninguna
// coordinación.
//
// FALLA POR CLÍNICA, NO POR BARRIDO. Es el mismo criterio del cron del briefing: si una revienta se
// registra y se sigue con la siguiente. Un barrido que se corta en la tercera clínica deja a las
// demás sin cobrar y sin que nadie se entere hasta fin de mes.

import { createAdminClient } from "@/lib/supabase/admin"
import { cobrarPeriodo, type ClinicaCobrable } from "@/lib/suscripcion/motor"

export type ResultadoBarrido = {
  revisadas: number
  cobradas: number
  bajadas: number
  /** Por qué no se le cobró a cada una. Es lo que hace diagnosticable un mes con poca recaudación. */
  omitidas: { clinicId: string; motivo: string }[]
}

/** Cuántas clínicas se atienden por corrida. Techo de contención, no un límite de negocio. */
const TOPE_POR_CORRIDA = 200

export async function barrerSuscripciones(ahora = new Date()): Promise<ResultadoBarrido> {
  const db = createAdminClient()
  const resultado: ResultadoBarrido = { revisadas: 0, cobradas: 0, bajadas: 0, omitidas: [] }

  const { data, error } = await db
    .from("clinics")
    .select(
      "id, plan, subscription_status, plan_renueva_en, plan_cancelado_en, wompi_payment_source_id, wompi_customer_email",
    )
    .lte("plan_renueva_en", ahora.toISOString())
    // `cortesia` e `inactive` no entran: no tienen nada que cobrar ni que vencer. Filtrarlo en la
    // consulta y no en el bucle evita traer las clínicas gratis, que van a ser la mayoría.
    //
    // `trial` SÍ entra desde la 0078, y no para cobrarle: para BAJARLA. Una prueba de tres días es
    // `plan = 'pro'` con fecha de vencimiento, así que el barrido ya la veía por `plan_renueva_en`
    // y era este filtro lo único que la dejaba afuera. Sin esto, la prueba no se termina nunca.
    .in("subscription_status", ["active", "past_due", "canceled", "trial"])
    .order("plan_renueva_en", { ascending: true })
    .limit(TOPE_POR_CORRIDA)

  if (error) {
    console.error("suscripcion/barrido: no se pudieron listar las clínicas", error)
    return resultado
  }

  const clinicas = (data ?? []) as (ClinicaCobrable & { plan_cancelado_en: string | null })[]
  resultado.revisadas = clinicas.length

  for (const clinica of clinicas) {
    try {
      // ── Canceladas: se les acabó el período pagado ────────────────────────────────────────────
      // Bajan acá y no el día que cancelaron. Ver `cancelarSuscripcion`: quien pagó el mes se lo usa
      // entero.
      if (clinica.subscription_status === "canceled") {
        await db
          .from("clinics")
          .update({
            plan: "free",
            subscription_status: "inactive",
            plan_renueva_en: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", clinica.id)
        resultado.bajadas += 1
        continue
      }

      // ── Prueba vencida: se acabaron los tres días ─────────────────────────────────────────────
      // Baja igual que una cancelada, pero por otro motivo y sin nada que cobrar: una prueba no
      // tiene tarjeta. Va ANTES del cobro porque `cobrarPeriodo` con `wompi_payment_source_id` en
      // null devolvería un fallo, y un fallo se cuenta como omitida — la clínica se quedaría en Pro
      // y el informe diría que no se le pudo cobrar, que es la lectura equivocada.
      if (clinica.subscription_status === "trial") {
        await db
          .from("clinics")
          .update({
            plan: "free",
            subscription_status: "inactive",
            plan_renueva_en: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", clinica.id)
        resultado.bajadas += 1
        continue
      }

      // ── Al día o en mora: se cobra ────────────────────────────────────────────────────────────
      const motivo = clinica.subscription_status === "past_due" ? "reintento" : "renovacion"
      const cobro = await cobrarPeriodo({ clinica, motivo, ahora })

      if (cobro.ok) {
        resultado.cobradas += 1
      } else {
        resultado.omitidas.push({ clinicId: clinica.id, motivo: cobro.motivo })
      }
    } catch (e) {
      console.error(`suscripcion/barrido: falló la clínica ${clinica.id}`, e)
      resultado.omitidas.push({ clinicId: clinica.id, motivo: "Excepción durante el cobro." })
    }
  }

  return resultado
}

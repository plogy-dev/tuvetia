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
import { comoPlan } from "@/lib/planes"

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

  // `plan` ya venía en el select; lo que faltaba era declararlo. Se necesita para distinguir una
  // prueba de verdad de una clínica `free` que arrastra el `trial` del default histórico.
  const clinicas = (data ?? []) as (ClinicaCobrable & {
    plan_cancelado_en: string | null
    plan: string | null
  })[]
  resultado.revisadas = clinicas.length

  for (const clinica of clinicas) {
    try {
      // ── Las dos que BAJAN, en un solo lugar ───────────────────────────────────────────────────
      //
      // CANCELADA: se le acabó el período pagado. Baja acá y no el día que canceló — ver
      // `cancelarSuscripcion`: quien pagó el mes se lo usa entero.
      //
      // PRUEBA VENCIDA: se acabaron los tres días. Baja igual, por otro motivo y sin nada que
      // cobrar. Va ANTES del cobro porque `cobrarPeriodo` sin `wompi_payment_source_id` devolvería
      // un fallo, el fallo se cuenta como omitida, y la clínica se quedaría en Pro mientras el
      // informe dice que no se le pudo cobrar — la lectura equivocada.
      //
      // Estaban en dos bloques idénticos salvo el estado. Van juntas porque "bajar a free" es UNA
      // cosa: el día que haya que registrar el motivo o avisarle a la clínica, se toca una vez.
      //
      // ⚠️ LA PRUEBA PIDE `plan === "pro"`, igual que `enPrueba()` en `lib/planes`. No es simetría
      // estética: `trial` es además el DEFAULT HISTÓRICO de la columna, y hay clínicas en `free` que
      // lo llevan sin haber probado nada. Mirando sólo el estado, cualquiera de ellas que llegara a
      // tener un `plan_renueva_en` vencido —una edición manual, un restore, un camino de alta
      // futuro— se contaría como una prueba que terminó. Dos funciones del mismo PR no pueden
      // discrepar sobre qué es estar en prueba.
      const pruebaVencida =
        clinica.subscription_status === "trial" && comoPlan(clinica.plan) === "pro"

      if (clinica.subscription_status === "canceled" || pruebaVencida) {
        // QUIEN YA PAGÓ NO SE BAJA. `/api/suscripcion/suscribir` guarda la fuente de pago y cobra,
        // pero NO escribe `subscription_status`: eso lo hace el webhook de Wompi, que es asíncrono y
        // normalmente vuelve PENDING. Una clínica que contrata el último día de prueba sigue en
        // `trial` hasta que el webhook llegue, y sin esto el barrido de ese día la degradaba —le
        // quitaba Athos a mitad de jornada y le borraba el `plan_renueva_en`, que es el reloj del
        // reintento. Se la deja para la corrida siguiente, cuando el webhook ya resolvió.
        if (pruebaVencida && clinica.wompi_payment_source_id) {
          resultado.omitidas.push({
            clinicId: clinica.id,
            motivo: "Prueba vencida pero ya cargó medio de pago: se espera al webhook.",
          })
          continue
        }

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

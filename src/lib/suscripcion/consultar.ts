import "server-only"

// Lo que las pantallas y los gates necesitan saber de la suscripción de una clínica.
//
// SEPARADO DEL MOTOR a propósito: esto sólo LEE, y lo llama el layout del dashboard en cada carga.
// El motor escribe, usa la llave de servicio y mueve plata. Mezclarlos haría que una pantalla
// arrastrara el cliente admin al árbol de imports por leer un plan.

import type { createClient } from "@/lib/supabase/server"
import { comoEstado, comoPlan, type EstadoSuscripcion, type Plan } from "@/lib/planes"

type ClienteDeSesion = Awaited<ReturnType<typeof createClient>>

export type EstadoDelPlan = {
  plan: Plan
  estado: EstadoSuscripcion
  /** Cuándo se cobra (o se reintenta) la próxima vez. `null` en free. */
  renuevaEn: string | null
  cancelado: boolean
  /** Para pintar "Visa ···· 4242". `null` si nunca se guardó una tarjeta. */
  tarjeta: { marca: string; ultimos4: string } | null
}

/** El estado con el que arranca cualquier lectura que falle. Free: negar, nunca conceder. */
export const PLAN_POR_DEFECTO: EstadoDelPlan = {
  plan: "free",
  estado: "inactive",
  renuevaEn: null,
  cancelado: false,
  tarjeta: null,
}

/**
 * El plan de la clínica de quien está mirando.
 *
 * FALLA CERRADA, y es lo contrario del criterio que usa el presupuesto de IA. Ahí una consulta que
 * no responde deja pasar, porque dejar a un veterinario sin Athos en medio de una consulta es peor
 * que pasarse del tope. Acá no: si no se puede leer el plan, se asume `free`. La diferencia es que
 * el tope de IA protege un costo nuestro y esto protege el cobro — un fallo de lectura que
 * regalara Pro sería un agujero que cualquiera podría provocar a voluntad.
 *
 * En la práctica no se nota: la misma consulta que falla acá ya hizo fallar media pantalla.
 */
export async function planDeLaClinica(
  supabase: ClienteDeSesion,
  clinicId: string | null,
): Promise<EstadoDelPlan> {
  if (!clinicId) return PLAN_POR_DEFECTO

  const { data, error } = await supabase
    .from("clinics")
    .select("plan, subscription_status, plan_renueva_en, plan_cancelado_en, tarjeta_marca, tarjeta_ultimos4")
    .eq("id", clinicId)
    .maybeSingle()

  if (error || !data) return PLAN_POR_DEFECTO

  const c = data as {
    plan: string | null
    subscription_status: string | null
    plan_renueva_en: string | null
    plan_cancelado_en: string | null
    tarjeta_marca: string | null
    tarjeta_ultimos4: string | null
  }

  return {
    plan: comoPlan(c.plan),
    estado: comoEstado(c.subscription_status),
    renuevaEn: c.plan_renueva_en,
    cancelado: Boolean(c.plan_cancelado_en),
    tarjeta:
      c.tarjeta_marca && c.tarjeta_ultimos4
        ? { marca: c.tarjeta_marca, ultimos4: c.tarjeta_ultimos4 }
        : null,
  }
}

export type CobroDelHistorial = {
  id: string
  fecha: string
  montoCentavos: number
  estado: string
  motivo: string
  periodoInicio: string | null
  periodoFin: string | null
}

/**
 * El historial de cobros, para la pantalla de Plan.
 *
 * Pasa por la sesión del usuario y no por la llave de servicio: la RLS de `suscripcion_cobros` ya
 * limita a la clínica propia, así que no hace falta —ni conviene— saltarla para leer esto.
 */
export async function historialDeCobros(
  supabase: ClienteDeSesion,
  limite = 12,
): Promise<CobroDelHistorial[]> {
  const { data } = await supabase
    .from("suscripcion_cobros")
    .select("id, created_at, monto_centavos, estado, motivo, periodo_inicio, periodo_fin")
    .order("created_at", { ascending: false })
    .limit(limite)

  const filas = (data ?? []) as {
    id: string
    created_at: string
    monto_centavos: number
    estado: string
    motivo: string
    periodo_inicio: string | null
    periodo_fin: string | null
  }[]

  return filas.map((f) => ({
    id: f.id,
    fecha: f.created_at,
    montoCentavos: f.monto_centavos,
    estado: f.estado,
    motivo: f.motivo,
    periodoInicio: f.periodo_inicio,
    periodoFin: f.periodo_fin,
  }))
}

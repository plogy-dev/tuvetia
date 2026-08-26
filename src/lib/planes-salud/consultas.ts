import "server-only"

// Los planes de salud: qué ofrece la clínica, qué tiene un paciente, y qué le queda.
//
// ── QUÉ ES UN PLAN DE SALUD ───────────────────────────────────────────────────────────────────
//
// El paquete que la clínica le vende al titular de una mascota: «3 consultas + 2 vacunas al año por
// $X». Lo pidió David el 25-ago con esas palabras — «un plan personalizado por paciente».
//
// ── LO QUE INCLUYE SALE DEL CATÁLOGO, NO DE UNA LISTA APARTE ──────────────────────────────────
//
// `health_plan_items` apunta a `catalog_items`. Así, cuando la clínica renombra «Consulta general»,
// cambia en el catálogo Y en el plan — y saber si una línea de factura está cubierta es comparar
// `catalog_item_id`, que la línea ya trae.

import type { SupabaseClient } from "@supabase/supabase-js"

export type PlanDeSalud = {
  id: string
  name: string
  description: string | null
  price_cents: number
  months: number
  active: boolean
  items: { catalog_item_id: string; qty: number; nombre: string }[]
}

/** Los planes que ofrece la clínica, con lo que incluye cada uno. */
export async function listarPlanes(
  supabase: SupabaseClient,
  clinicId: string,
  opts: { incluirInactivos?: boolean } = {},
): Promise<PlanDeSalud[]> {
  let q = supabase
    .from("health_plans")
    .select(
      "id, name, description, price_cents, months, active, items:health_plan_items(catalog_item_id, qty, item:catalog_items!health_plan_items_catalog_item_id_fkey(name))",
    )
    .eq("clinic_id", clinicId)
    .order("name")
  if (!opts.incluirInactivos) q = q.eq("active", true)

  const { data, error } = await q
  if (error) throw new Error(`No se pudieron leer los planes: ${error.message}`)

  return ((data ?? []) as unknown as {
    id: string
    name: string
    description: string | null
    price_cents: number
    months: number
    active: boolean
    items: { catalog_item_id: string; qty: number; item: { name: string } | null }[]
  }[]).map((p) => ({
    ...p,
    items: (p.items ?? []).map((i) => ({
      catalog_item_id: i.catalog_item_id,
      qty: i.qty,
      nombre: i.item?.name ?? "—",
    })),
  }))
}

export type CoberturaDeUnServicio = {
  catalogItemId: string
  nombre: string
  incluidas: number
  usadas: number
  /** Lo que queda. Nunca negativo: el trigger de la base impide pasarse. */
  restantes: number
}

export type PlanDelPaciente = {
  contratoId: string
  planNombre: string
  desde: string
  hasta: string
  /** Si hoy cae dentro de la vigencia. Un plan vencido se muestra, pero no cubre. */
  vigente: boolean
  cobertura: CoberturaDeUnServicio[]
}

/**
 * El plan de un paciente y cuánto le queda de cada cosa.
 *
 * DEVUELVE EL MÁS RECIENTE Y NO TODOS: un paciente puede haber tenido plan el año pasado y otro
 * este año, y lo que la pantalla de facturación necesita saber es qué le cubre HOY. El historial
 * completo es otra pregunta y todavía no la hace nadie.
 */
export async function planDelPaciente(
  supabase: SupabaseClient,
  clinicId: string,
  patientId: string,
  hoy = new Date(),
): Promise<PlanDelPaciente | null> {
  const { data, error } = await supabase
    .from("patient_health_plans")
    .select(
      "id, starts_on, ends_on, plan:health_plans!patient_health_plans_plan_id_fkey(name, items:health_plan_items(catalog_item_id, qty, item:catalog_items!health_plan_items_catalog_item_id_fkey(name)))",
    )
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .order("ends_on", { ascending: false })
    .limit(1)
    .maybeSingle()

  // Un fallo leyendo el plan NO puede tumbar la pantalla de facturación: se factura sin cobertura,
  // que es lo que pasaba antes de que existieran los planes.
  if (error || !data) return null

  const fila = data as unknown as {
    id: string
    starts_on: string
    ends_on: string
    plan: {
      name: string
      items: { catalog_item_id: string; qty: number; item: { name: string } | null }[]
    } | null
  }
  if (!fila.plan) return null

  const { data: usos } = await supabase
    .from("health_plan_uses")
    .select("catalog_item_id, qty")
    .eq("patient_health_plan_id", fila.id)

  const usadoPorItem = new Map<string, number>()
  for (const u of ((usos ?? []) as { catalog_item_id: string; qty: number }[])) {
    usadoPorItem.set(u.catalog_item_id, (usadoPorItem.get(u.catalog_item_id) ?? 0) + u.qty)
  }

  const hoyISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(hoy)

  return {
    contratoId: fila.id,
    planNombre: fila.plan.name,
    desde: fila.starts_on,
    hasta: fila.ends_on,
    vigente: hoyISO >= fila.starts_on && hoyISO <= fila.ends_on,
    cobertura: (fila.plan.items ?? []).map((i) => {
      const usadas = usadoPorItem.get(i.catalog_item_id) ?? 0
      return {
        catalogItemId: i.catalog_item_id,
        nombre: i.item?.name ?? "—",
        incluidas: i.qty,
        usadas,
        restantes: Math.max(0, i.qty - usadas),
      }
    }),
  }
}

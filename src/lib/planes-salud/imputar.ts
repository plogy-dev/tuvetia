// Imputa al plan de salud lo que la factura emitida consumió — la vuelta que faltaba.
//
// ── LA REGLA: SE IMPUTA LO QUE SE COBRÓ EN CERO ───────────────────────────────────────────────
//
// El carrito AVISA («lo cubre el plan, quedan 2 de 3») y el vet decide: si imputa al plan, deja la
// línea en $0; si prefiere cobrarla, le pone precio. Esta función lee esa decisión de vuelta: una
// línea cubierta Y en cero se registra como uso del plan; una línea cubierta pero COBRADA no toca
// el contador — el titular pagó por fuera del plan y le quedan sus usos.
//
// Automatizar más que esto sería adivinar: descontar solo (el precio lo pone el vet) o consumir
// usos de algo que se cobró completo (el titular pagaría dos veces: en plata y en cupo).
//
// ── NUNCA TUMBA LA EMISIÓN ────────────────────────────────────────────────────────────────────
//
// Corre después de que la factura quedó EMITIDA con su consecutivo fiscal. Un fallo acá se reporta
// como warning y a consola, jamás como excepción: el trigger de la base (0088) es la red que
// impide sobreconsumir, y un uso sin registrar se corrige a mano — un consecutivo quemado por un
// contador de plan, no.

import type { SupabaseClient } from "@supabase/supabase-js"

export type LineaEmitida = {
  catalog_item_id: string | null
  qty: number
  total_cents: number
}

export type CoberturaRestante = {
  catalogItemId: string
  restantes: number
}

export type UsoAImputar = {
  catalogItemId: string
  qty: number
  /** true cuando la línea pedía más usos de los que quedaban: se imputa lo que queda y se avisa. */
  recortado: boolean
}

/**
 * Qué usos registrar, dada la factura y lo que le queda al contrato. PURA, con test.
 *
 * El recorte al restante va ACÁ y no confiado al trigger: el trigger RECHAZA el insert entero, y
 * lo correcto cuando la línea en cero pide 3 y quedan 2 es imputar 2 y avisar — no perder los dos.
 */
export function usosAImputar(
  lineas: LineaEmitida[],
  cobertura: CoberturaRestante[],
): UsoAImputar[] {
  const restantes = new Map(cobertura.map((c) => [c.catalogItemId, c.restantes]))
  const usos: UsoAImputar[] = []
  for (const l of lineas) {
    if (!l.catalog_item_id) continue
    // Sólo lo que el vet dejó en $0: ésa es la señal de «va por el plan». Una línea cobrada no
    // consume cupo aunque el ítem esté cubierto.
    if (l.total_cents !== 0) continue
    const disponibles = restantes.get(l.catalog_item_id) ?? 0
    if (disponibles <= 0) continue
    const qty = Math.min(l.qty, disponibles)
    restantes.set(l.catalog_item_id, disponibles - qty)
    usos.push({ catalogItemId: l.catalog_item_id, qty, recortado: qty < l.qty })
  }
  return usos
}

/**
 * El lado con IO: busca el contrato vigente a la fecha de emisión, calcula con la pura, inserta.
 * Devuelve avisos legibles para el resultado de la emisión; los fallos van a consola y como aviso.
 */
export async function imputarConsumosDelPlan(
  supabase: SupabaseClient,
  clinicId: string,
  args: {
    patientId: string
    invoiceId: string
    /** YYYY-MM-DD del día de Bogotá de la emisión: la vigencia del plan es calendario, no instante. */
    issuedOn: string
    createdBy: string | null
    lineas: LineaEmitida[]
  },
): Promise<string[]> {
  try {
    const { data: contrato } = await supabase
      .from("patient_health_plans")
      .select("id, plan:health_plans!patient_health_plans_plan_id_fkey(name, items:health_plan_items(catalog_item_id, qty))")
      .eq("clinic_id", clinicId)
      .eq("patient_id", args.patientId)
      .lte("starts_on", args.issuedOn)
      .gte("ends_on", args.issuedOn)
      .order("ends_on", { ascending: false })
      .limit(1)
      .maybeSingle()

    const c = contrato as unknown as {
      id: string
      plan: { name: string; items: { catalog_item_id: string; qty: number }[] } | null
    } | null
    if (!c?.plan) return []

    const { data: usados } = await supabase
      .from("health_plan_uses")
      .select("catalog_item_id, qty")
      .eq("patient_health_plan_id", c.id)

    const usadoPorItem = new Map<string, number>()
    for (const u of ((usados ?? []) as { catalog_item_id: string; qty: number }[])) {
      usadoPorItem.set(u.catalog_item_id, (usadoPorItem.get(u.catalog_item_id) ?? 0) + u.qty)
    }
    const cobertura: CoberturaRestante[] = c.plan.items.map((i) => ({
      catalogItemId: i.catalog_item_id,
      restantes: Math.max(0, i.qty - (usadoPorItem.get(i.catalog_item_id) ?? 0)),
    }))

    const usos = usosAImputar(args.lineas, cobertura)
    if (usos.length === 0) return []

    const { error } = await supabase.from("health_plan_uses").insert(
      usos.map((u) => ({
        patient_health_plan_id: c.id,
        catalog_item_id: u.catalogItemId,
        invoice_id: args.invoiceId,
        qty: u.qty,
        created_by: args.createdBy,
      })),
    )
    if (error) {
      console.error(`[planes-salud] la factura ${args.invoiceId} no pudo imputar sus usos:`, error)
      return [
        `La factura salió bien, pero el consumo del plan «${c.plan.name}» no quedó registrado: ${error.message}. Registralo desde la ficha del paciente.`,
      ]
    }

    const avisos = usos.map((u) =>
      u.recortado
        ? `Se imputaron ${u.qty} al plan «${c.plan!.name}» — la línea pedía más de lo que quedaba.`
        : `${u.qty} ${u.qty === 1 ? "uso imputado" : "usos imputados"} al plan «${c.plan!.name}».`,
    )
    return avisos
  } catch (e) {
    console.error(`[planes-salud] imputación de la factura ${args.invoiceId} falló:`, e)
    return ["La factura salió bien, pero no se pudo revisar el plan de salud del paciente."]
  }
}

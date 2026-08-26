"use server"

// Crear y editar planes de salud, y contratárselos a un paciente.
//
// DETRÁS DE `requireClinicAdmin`: un plan es un precio y un compromiso de servicios. No es una
// preferencia de pantalla.

import { z } from "zod"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requireClinicAdmin } from "@/lib/clinic-role"

type Err = { ok: false; error: string }
export type Result<P = unknown> = ({ ok: true } & P) | Err

async function contexto() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")
  await requireClinicAdmin()
  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle()
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
  if (!clinicId) throw new Error("El usuario no tiene clínica")
  return { supabase, clinicId, userId: user.id }
}

const PlanSchema = z.object({
  id: z.string().uuid().nullish(),
  nombre: z.string().trim().min(3, "El plan necesita un nombre").max(120),
  descripcion: z.string().trim().max(500).nullish(),
  precioPesos: z.number().min(0, "El precio no puede ser negativo"),
  meses: z.number().int().min(1).max(60),
  /** Qué incluye: ítem del catálogo + cuántas veces. */
  items: z
    .array(z.object({ catalogItemId: z.string().uuid(), qty: z.number().int().min(1).max(99) }))
    .min(1, "Un plan sin servicios no cubre nada"),
})

/**
 * Guarda un plan con lo que incluye.
 *
 * LOS ÍTEMS SE REESCRIBEN ENTEROS, no se hace un diff. Un plan tiene tres o cuatro renglones y
 * calcular altas/bajas/cambios sería más código con más formas de equivocarse; borrar e insertar
 * dentro de la misma acción da el mismo resultado y se lee de una.
 *
 * Los CONTRATOS YA FIRMADOS no se tocan: apuntan al plan, pero su precio está congelado y su
 * cobertura se calcula contra `health_plan_items`… que sí cambia. Es el comportamiento correcto
 * —agregarle un servicio a un plan beneficia a quien ya lo tiene— y vale saberlo: quitar un
 * servicio se lo quita también.
 */
export async function guardarPlan(input: z.input<typeof PlanSchema>): Promise<Result<{ id: string }>> {
  try {
    const { supabase, clinicId, userId } = await contexto()
    const parsed = PlanSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" }
    }
    const d = parsed.data

    // El mismo servicio dos veces sería ambiguo (¿2+3 o se pisan?) y la base lo rechaza con un
    // UNIQUE. Se detecta acá para dar el mensaje en español.
    const ids = d.items.map((i) => i.catalogItemId)
    if (new Set(ids).size !== ids.length) {
      return { ok: false, error: "Hay un servicio repetido: ponelo una vez con su cantidad." }
    }

    const fila = {
      clinic_id: clinicId,
      name: d.nombre,
      description: d.descripcion?.trim() || null,
      price_cents: Math.round(d.precioPesos * 100),
      months: d.meses,
      updated_at: new Date().toISOString(),
    }

    let planId = d.id ?? null
    if (planId) {
      const { error } = await supabase.from("health_plans").update(fila).eq("id", planId).eq("clinic_id", clinicId)
      if (error) throw new Error(error.message)
      await supabase.from("health_plan_items").delete().eq("plan_id", planId)
    } else {
      const { data, error } = await supabase
        .from("health_plans")
        .insert({ ...fila, created_by: userId })
        .select("id")
        .single()
      if (error) throw new Error(error.message)
      planId = (data as { id: string }).id
    }

    const { error: itemsErr } = await supabase.from("health_plan_items").insert(
      d.items.map((i) => ({ plan_id: planId, catalog_item_id: i.catalogItemId, qty: i.qty })),
    )
    if (itemsErr) throw new Error(`No se pudo guardar lo que incluye: ${itemsErr.message}`)

    revalidatePath("/dashboard/administracion/planes-salud")
    return { ok: true, id: planId as string }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" }
  }
}

/** Archivar un plan: deja de ofrecerse, y los contratos vigentes siguen valiendo. */
export async function archivarPlan(input: { id: string; activo: boolean }): Promise<Result> {
  try {
    const { supabase, clinicId } = await contexto()
    const { error } = await supabase
      .from("health_plans")
      .update({ active: input.activo, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("clinic_id", clinicId)
    if (error) throw new Error(error.message)
    revalidatePath("/dashboard/administracion/planes-salud")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" }
  }
}

const ContratoSchema = z.object({
  patientId: z.string().uuid(),
  planId: z.string().uuid(),
})

/**
 * Le contrata un plan a un paciente.
 *
 * EL PRECIO SE COPIA, NO SE REFERENCIA — es lo mismo que hace `invoice_lines` con el catálogo: si
 * mañana el plan sube de $300.000 a $350.000, quien lo compró hoy conserva lo que pagó.
 *
 * La vigencia se calcula desde HOY con los meses del plan, del lado del servidor. Recibirla del
 * navegador dejaría que alguien se contrate un plan de diez años.
 */
export async function contratarPlan(input: z.input<typeof ContratoSchema>): Promise<Result> {
  try {
    const { supabase, clinicId, userId } = await contexto()
    const parsed = ContratoSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: "Datos inválidos" }

    const { data: plan, error: planErr } = await supabase
      .from("health_plans")
      .select("price_cents, months, active")
      .eq("id", parsed.data.planId)
      .eq("clinic_id", clinicId)
      .maybeSingle()
    if (planErr) throw new Error(planErr.message)
    const p = plan as { price_cents: number; months: number; active: boolean } | null
    if (!p) return { ok: false, error: "Ese plan no existe" }
    if (!p.active) return { ok: false, error: "Ese plan está archivado: reactivalo antes de venderlo." }

    const desde = new Date()
    // SIN `setMonth`: contratado el 31-ago un plan de 6 meses, `setMonth` produce «Feb 31» y JS lo
    // rueda al 2-3 de marzo — días de cobertura regalados. Es el desborde que suscripcion/periodo
    // documenta; acá se aplica el mismo criterio con n meses: el día se RECORTA al último del mes
    // destino, nunca se rueda (revisión del 26-ago).
    const iso = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d)
    const [anio0, mes0, dia0] = iso(desde).split("-").map(Number)
    const mesDestino = mes0 - 1 + p.months
    const ultimoDiaDelDestino = new Date(Date.UTC(anio0, mesDestino + 1, 0)).getUTCDate()
    const hasta = new Date(Date.UTC(anio0, mesDestino, Math.min(dia0, ultimoDiaDelDestino)))

    const { error } = await supabase.from("patient_health_plans").insert({
      clinic_id: clinicId,
      patient_id: parsed.data.patientId,
      plan_id: parsed.data.planId,
      price_cents: p.price_cents,
      starts_on: iso(desde),
      // `hasta` ya ES un día civil (medianoche UTC del día calculado): se serializa directo —
      // pasarlo por iso() con zona Bogotá lo retrocedería un día.
      ends_on: hasta.toISOString().slice(0, 10),
      created_by: userId,
    })
    if (error) throw new Error(`No se pudo contratar: ${error.message}`)

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" }
  }
}

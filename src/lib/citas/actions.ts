"use server"

// Los ajustes del recordatorio de cita.
//
// DETRÁS DE `requireClinicAdmin`: esto decide si la clínica le escribe sola a sus clientes y qué
// les dice. No es una preferencia de pantalla — es la voz de la clínica hacia afuera.

import { z } from "zod"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requireClinicAdmin } from "@/lib/clinic-role"
import { LARGO_MAXIMO, revisarTexto } from "./recordatorio"

type Err = { ok: false; error: string }
export type Result = { ok: true } | Err

const Ajustes = z.object({
  activo: z.boolean(),
  /** En horas. El CHECK de la base acota a 1..168; acá se acota igual para dar el mensaje bueno. */
  horas: z.number().int().min(1).max(168),
  texto: z.string().trim().max(LARGO_MAXIMO).nullish(),
})

export async function guardarRecordatorioDeCitas(
  input: z.input<typeof Ajustes>,
): Promise<Result> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "No autenticado" }
    await requireClinicAdmin()

    const parsed = Ajustes.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" }
    }
    const d = parsed.data

    const texto = d.texto?.trim() || null
    if (texto) {
      // La misma revisión que corre en la pantalla. Acá es la que manda: un formulario se salta.
      const problema = revisarTexto(texto)
      if (problema) return { ok: false, error: problema }
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("clinic_id")
      .eq("id", user.id)
      .maybeSingle()
    const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
    if (!clinicId) return { ok: false, error: "El usuario no tiene clínica" }

    const { error } = await supabase
      .from("clinics")
      .update({
        recordatorio_citas_activo: d.activo,
        recordatorio_citas_horas: d.horas,
        // Vacío = volver al texto por defecto, no guardar una cadena vacía. Es la misma decisión
        // que las plantillas de cobranza: «no elegí» y «elegí esto» son estados distintos.
        recordatorio_citas_texto: texto,
      })
      .eq("id", clinicId)
    if (error) throw new Error(`No se pudo guardar: ${error.message}`)

    revalidatePath("/dashboard/settings")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" }
  }
}

"use server"

// El catálogo de vacunas de la clínica — las acciones de la primera «Variable» (26-ago).
//
// Detrás de `requireClinicAdmin`, como los planes de salud: un catálogo define lo que toda la
// clínica ve en sus selectores. No es una preferencia de pantalla.

import { z } from "zod"
import { revalidatePath } from "next/cache"

import { requireClinicAdmin } from "@/lib/clinic-role"

type Err = { ok: false; error: string }
export type Result<P = unknown> = ({ ok: true } & P) | Err

const RUTA = "/dashboard/administracion/variables/vacunas"

const VacunaSchema = z.object({
  nombre: z.string().trim().min(2, "La vacuna necesita un nombre").max(120),
  especie: z.string().trim().max(60).nullish(),
})

export async function crearVacuna(input: z.input<typeof VacunaSchema>): Promise<Result> {
  try {
    const { supabase, clinicId, userId } = await requireClinicAdmin()
    const parsed = VacunaSchema.safeParse(input)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" }

    const { error } = await supabase.from("vaccine_types").insert({
      clinic_id: clinicId,
      name: parsed.data.nombre,
      species: parsed.data.especie?.trim() || null,
      created_by: userId,
    })
    if (error) {
      // El índice normalizado de la 0090: «rabia » es «Rabia». El mensaje va en español acá.
      if (error.code === "23505") return { ok: false, error: "Esa vacuna ya está en el catálogo." }
      throw new Error(error.message)
    }
    revalidatePath(RUTA)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" }
  }
}

/** Archivar en vez de borrar: las aplicaciones YA registradas nombran esta vacuna en texto. */
export async function archivarVacuna(input: { id: string; activa: boolean }): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinicAdmin()
    const { error } = await supabase
      .from("vaccine_types")
      .update({ active: input.activa })
      .eq("id", input.id)
      .eq("clinic_id", clinicId)
    if (error) throw new Error(error.message)
    revalidatePath(RUTA)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" }
  }
}

/**
 * Siembra las comunes de Colombia en un catálogo vacío.
 *
 * Existe porque un catálogo que arranca en blanco le pide al admin teclear ocho nombres antes de
 * ver el beneficio — y el estado vacío del repo exige SALIDA, no un cartel. La lista es la de
 * siempre en clínica de compañía; se edita y se archiva como cualquier otra fila.
 */
export async function sembrarVacunasComunes(): Promise<Result<{ sembradas: number }>> {
  const COMUNES: { name: string; species: string | null }[] = [
    { name: "Rabia", species: null },
    { name: "Polivalente (quíntuple)", species: "Perro" },
    { name: "Moquillo", species: "Perro" },
    { name: "Parvovirus", species: "Perro" },
    { name: "Tos de las perreras (Bordetella)", species: "Perro" },
    { name: "Triple felina", species: "Gato" },
    { name: "Leucemia felina", species: "Gato" },
  ]
  try {
    const { supabase, clinicId, userId } = await requireClinicAdmin()
    // Sólo sobre catálogo VACÍO: sembrar encima de uno armado re-mete lo que el admin ya borró.
    const { count } = await supabase
      .from("vaccine_types")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId)
    if ((count ?? 0) > 0) return { ok: false, error: "El catálogo ya tiene vacunas: agregalas de a una." }

    const { error } = await supabase.from("vaccine_types").insert(
      COMUNES.map((v) => ({ clinic_id: clinicId, name: v.name, species: v.species, created_by: userId })),
    )
    if (error) throw new Error(error.message)
    revalidatePath(RUTA)
    return { ok: true, sembradas: COMUNES.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" }
  }
}

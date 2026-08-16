// Validación y normalización de la edición de un paciente.
//
// POR QUÉ EXISTE ESTA EDICIÓN. Hasta hoy `patients` no tenía NINGUNA ruta de UPDATE en el producto:
// se creaba un paciente y un error de tipeo en el nombre quedaba así para siempre. Para una clínica
// que carga sus pacientes reales la primera semana, es un fallo de día 1.
//
// La RLS ya lo permitía: `patients_update` es `using (clinic_id = private.my_clinic_id())` y, al no
// declarar `with_check`, Postgres reusa esa misma expresión para la fila nueva — así que un vet
// puede corregir pacientes de su clínica y NO puede moverlos a otra. No hizo falta migración.
//
// Vive en un `.ts` sin React para poder probarlo en vitest, que corre en `environment: "node"`.

import { bogotaTodayISO } from "@/lib/date-utils"

/** Lo que el formulario tiene en la mano: todo texto, como sale de un `<input>`. */
export type CamposDePaciente = {
  name: string
  species: string
  breed: string
  sex: string
  /** "" o YYYY-MM-DD */
  birthDate: string
  /** "" o un número como texto */
  weightKg: string
}

/** Lo que se manda a `patients`, con los nombres de columna reales. */
export type PayloadDePaciente = {
  name: string
  species: string
  breed: string | null
  sex: string
  birth_date: string | null
  weight_kg: number | null
}

export const SEXOS = ["male", "female", "unknown"] as const

/**
 * Tope de peso, en kilos.
 *
 * No es un dato veterinario: es un cazador de typos. El paciente más pesado que puede entrar a una
 * clínica de pequeños animales no llega a 100 kg, y "35" tecleado como "350" es el error que esto
 * ataja. Medido contra el principal el 2026-08-16: ningún paciente supera los 200.
 */
export const PESO_MAXIMO_KG = 200

export type ResultadoDeValidacion =
  | { ok: true; cambios: Partial<PayloadDePaciente> }
  | { ok: false; errores: Partial<Record<keyof CamposDePaciente, string>> }

function aPayload(c: CamposDePaciente): PayloadDePaciente {
  return {
    name: c.name.trim(),
    species: c.species.trim(),
    breed: c.breed.trim() || null,
    sex: c.sex,
    birth_date: c.birthDate || null,
    weight_kg: c.weightKg.trim() ? Number(c.weightKg) : null,
  }
}

/**
 * Valida y devuelve **sólo lo que cambió**.
 *
 * Devolver el diff y no el objeto entero tiene dos efectos que importan: un guardado sin cambios no
 * escribe nada (y no toca `updated_at`), y el UPDATE no pisa columnas que este formulario ni
 * siquiera muestra.
 *
 * LA FECHA DE NACIMIENTO SÓLO SE VALIDA SI CAMBIÓ, y no es una concesión: medido contra el
 * principal el 2026-08-16, **2 de 46 pacientes ya tienen una fecha futura guardada**. Validarla
 * siempre le impediría al vet corregirle el NOMBRE a esos dos hasta que además les arreglara la
 * fecha — castigar una edición por un dato viejo que no se está tocando.
 */
export function validarPaciente(
  campos: CamposDePaciente,
  original: CamposDePaciente,
  hoy: string = bogotaTodayISO(),
): ResultadoDeValidacion {
  const errores: Partial<Record<keyof CamposDePaciente, string>> = {}

  if (!campos.name.trim()) errores.name = "El nombre no puede quedar vacío."
  if (!campos.species.trim()) errores.species = "La especie no puede quedar vacía."
  if (!(SEXOS as readonly string[]).includes(campos.sex)) errores.sex = "Sexo no válido."

  if (campos.birthDate !== original.birthDate && campos.birthDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(campos.birthDate) || Number.isNaN(Date.parse(campos.birthDate))) {
      errores.birthDate = "La fecha no es válida."
    } else if (campos.birthDate > hoy) {
      errores.birthDate = "La fecha de nacimiento no puede ser futura."
    }
  }

  const peso = campos.weightKg.trim()
  if (peso) {
    const n = Number(peso)
    if (!Number.isFinite(n)) errores.weightKg = "El peso tiene que ser un número."
    else if (n <= 0) errores.weightKg = "El peso tiene que ser mayor que cero."
    else if (n > PESO_MAXIMO_KG) errores.weightKg = `¿${n} kg? Revisá el número.`
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores }

  const nuevo = aPayload(campos)
  const viejo = aPayload(original)
  const cambios: Partial<PayloadDePaciente> = {}
  for (const k of Object.keys(nuevo) as (keyof PayloadDePaciente)[]) {
    if (nuevo[k] !== viejo[k]) Object.assign(cambios, { [k]: nuevo[k] })
  }

  return { ok: true, cambios }
}

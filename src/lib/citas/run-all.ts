import "server-only"

// Recorre las clínicas que tienen el recordatorio de cita encendido.
//
// EN SERIE Y NO EN PARALELO, igual que cartera: cada clínica manda por su propia instancia de
// Evolution, y `sendWhatsAppText` ya aplica cadencia humana entre mensajes. Dispararlas todas a la
// vez no las haría más rápidas —el cuello es el proveedor— y sí multiplicaría la memoria de la
// función por el número de clínicas.
//
// UNA CLÍNICA QUE FALLA NO DEJA A LAS DEMÁS SIN AVISAR: `barrerRecordatoriosDeCita` devuelve el
// recuento en vez de lanzar, y acá se acumula lo que devuelva.

import { createAdminClient } from "@/lib/supabase/admin"
import { barrerRecordatoriosDeCita, type ResultadoDelBarrido } from "./barrido"

export async function correrRecordatoriosDeCita(
  ahora = new Date(),
): Promise<{ clinicas: number; resultados: ResultadoDelBarrido[] }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("clinics")
    .select("id, name, recordatorio_citas_activo, recordatorio_citas_horas, recordatorio_citas_texto")
    .eq("recordatorio_citas_activo", true)
  if (error) throw new Error(`No se pudieron leer las clínicas: ${error.message}`)

  const clinicas = (data ?? []) as {
    id: string
    name: string
    recordatorio_citas_activo: boolean
    recordatorio_citas_horas: number
    recordatorio_citas_texto: string | null
  }[]

  const resultados: ResultadoDelBarrido[] = []
  for (const c of clinicas) {
    resultados.push(
      await barrerRecordatoriosDeCita(
        c.id,
        c.name,
        {
          activo: c.recordatorio_citas_activo,
          horas: c.recordatorio_citas_horas,
          texto: c.recordatorio_citas_texto,
        },
        ahora,
      ),
    )
  }
  return { clinicas: clinicas.length, resultados }
}

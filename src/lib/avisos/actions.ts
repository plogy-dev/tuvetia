"use server"

// Los avisos a titulares, desde la pantalla.
//
// DETRÁS DE `requireClinicAdmin`: esto le escribe a los clientes de la clínica en nombre de la
// clínica. No es una preferencia — es su voz hacia afuera, y además gasta la reputación de un
// dominio que comparten todas.

import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { requireClinicAdmin } from "@/lib/clinic-role"
import { armarAudiencia, SEGMENTOS, TOPE, type Segmento } from "./audiencia"
import { enviarAviso } from "./envio"

type Err = { ok: false; error: string }
export type Result<P = unknown> = ({ ok: true } & P) | Err

const SEGMENTO = z.enum(Object.keys(SEGMENTOS) as [Segmento, ...Segmento[]])

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
  return { clinicId, userId: user.id }
}

/** Cuántos son, antes de escribir nada. La clínica no manda a ciegas. */
export async function contarAudiencia(
  input: { segmento: string },
): Promise<Result<{ total: number; deBaja: number; sinCorreo: number; tope: number }>> {
  try {
    const { clinicId } = await contexto()
    const seg = SEGMENTO.safeParse(input.segmento)
    if (!seg.success) return { ok: false, error: "Segmento inválido" }
    const a = await armarAudiencia(clinicId, seg.data)
    return {
      ok: true,
      total: a.destinatarios.length,
      deBaja: a.deBaja,
      sinCorreo: a.sinCorreo,
      tope: TOPE,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" }
  }
}

const Aviso = z.object({
  segmento: SEGMENTO,
  asunto: z.string().trim().min(3, "El asunto no puede ir vacío").max(150),
  cuerpo: z.string().trim().min(20, "El mensaje es demasiado corto").max(4000),
})

/**
 * Manda el aviso.
 *
 * LA AUDIENCIA SE VUELVE A ARMAR ACÁ, no se recibe del navegador. Recibir la lista de correos
 * significaría que quien manipule la petición elige a quién le escribe la clínica — incluidos
 * correos de otra clínica, o de alguien que se dio de baja.
 */
/**
 * `segmento` entra como `string` a propósito: es lo que manda un formulario, y el zod de adentro es
 * el que decide si vale. Tipar el parámetro con la unión obligaría al llamador a hacer un `as` — o
 * sea, a afirmar algo que todavía no comprobó nadie.
 */
export async function mandarAviso(input: {
  segmento: string
  asunto: string
  cuerpo: string
}): Promise<
  Result<{ enviados: number; excluidosPorBaja: number; fallidos: number }>
> {
  try {
    const { clinicId, userId } = await contexto()
    const parsed = Aviso.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" }
    }
    const base = process.env.NEXT_PUBLIC_SITE_URL
    if (!base) return { ok: false, error: "Falta NEXT_PUBLIC_SITE_URL para armar el enlace de baja." }

    const audiencia = await armarAudiencia(clinicId, parsed.data.segmento)
    if (audiencia.destinatarios.length === 0) {
      return { ok: false, error: "No hay a quién mandarle: ese segmento quedó vacío." }
    }

    const r = await enviarAviso(
      clinicId,
      userId,
      audiencia.destinatarios,
      parsed.data.asunto,
      parsed.data.cuerpo,
      base,
    )
    return {
      ok: true,
      enviados: r.enviados,
      excluidosPorBaja: r.excluidosPorBaja,
      fallidos: r.fallidos.length,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error inesperado" }
  }
}

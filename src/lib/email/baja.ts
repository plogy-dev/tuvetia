import "server-only"

// La baja del correo: quién dejó de querer los avisos de su clínica, y cómo se respeta.
//
// ── LA BAJA ES DE LOS AVISOS, NO DE LO QUE LA CLÍNICA DEBE COMUNICARLE ─────────────────────────
//
// Es la distinción que sostiene todo lo demás, y por eso el filtro vive ACÁ y no dentro de
// `sendTransactionalEmail`. Darse de baja de "a Nala le toca la vacuna" NO puede dar de baja de
// "tenés una factura vencida" ni del envío de una factura: eso es la relación contractual, y la
// cobranza tiene su propio régimen (Ley 2300) con su propio gate.
//
// Si el filtro estuviera en el transporte, la primera baja apagaría la cobranza de ese titular y
// nadie lo notaría hasta que faltara la plata.
//
// ── EL CORREO SE NORMALIZA EN LOS DOS EXTREMOS ────────────────────────────────────────────────
//
// `Ana@X.com` y `ana@x.com` son la misma casilla. Como el correo está en la clave primaria, sin
// normalizar entrarían como dos filas distintas y el filtro dejaría pasar una de las dos — o sea,
// le seguiría llegando correo a quien se dio de baja, que es el único fallo que esta función no
// puede tener.

import { createAdminClient } from "@/lib/supabase/admin"

/** El token es la única credencial de una página sin sesión: se valida la FORMA antes de consultar. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function esTokenDeBaja(valor: string | null | undefined): boolean {
  return typeof valor === "string" && UUID.test(valor)
}

/** Minúsculas y sin espacios. La misma función la usan el filtro y la escritura. */
export function normalizarCorreo(valor: string | null | undefined): string {
  return (valor ?? "").trim().toLowerCase()
}

export type TitularDeLaBaja = {
  ownerId: string
  clinicId: string
  nombre: string | null
  email: string | null
  clinica: string | null
  yaDeBaja: boolean
}

/**
 * Quién es el titular detrás de un token. `null` si el token no existe.
 *
 * Se lee con `service_role` porque el visitante es anónimo —la RLS le negaría todo— y por eso cada
 * consulta lleva su filtro explícito, que es la regla del repo para `service_role`.
 */
export async function titularPorToken(token: string): Promise<TitularDeLaBaja | null> {
  if (!esTokenDeBaja(token)) return null
  const admin = createAdminClient()

  const { data } = await admin
    .from("owners")
    .select("id, clinic_id, full_name, email, clinic:clinics!owners_clinic_id_fkey(name)")
    .eq("unsubscribe_token", token)
    .maybeSingle()
  if (!data) return null

  const o = data as unknown as {
    id: string
    clinic_id: string
    full_name: string | null
    email: string | null
    clinic: { name: string | null } | null
  }

  const correo = normalizarCorreo(o.email)
  const { count } = await admin
    .from("owner_email_optout")
    .select("owner_id", { count: "exact", head: true })
    .eq("clinic_id", o.clinic_id)
    .eq("owner_id", o.id)
    .eq("email", correo)

  return {
    ownerId: o.id,
    clinicId: o.clinic_id,
    nombre: o.full_name,
    email: o.email,
    clinica: o.clinic?.name ?? null,
    yaDeBaja: (count ?? 0) > 0,
  }
}

/** Da de baja una dirección. Repetir la baja no es un error: es el mismo estado. */
export async function registrarBaja(token: string, motivo?: string | null): Promise<boolean> {
  const titular = await titularPorToken(token)
  if (!titular) return false

  const correo = normalizarCorreo(titular.email)
  // Sin correo en la ficha no hay dirección que dar de baja — y tampoco había cómo mandarle nada.
  if (!correo) return false

  const admin = createAdminClient()
  const { error } = await admin
    .from("owner_email_optout")
    .upsert(
      {
        clinic_id: titular.clinicId,
        owner_id: titular.ownerId,
        email: correo,
        motivo: motivo?.trim() ? motivo.trim().slice(0, 500) : null,
      },
      { onConflict: "clinic_id,owner_id,email" },
    )
  return !error
}

/**
 * Saca de una lista a quien se dio de baja. **Todo envío masivo pasa por acá.**
 *
 * SE VUELVE A COMPROBAR EN EL ENVÍO, no sólo al armar la audiencia: entre que alguien elige a 200
 * titulares y aprieta enviar pueden pasar diez minutos, y en el medio alguien pudo darse de baja.
 * Filtrar sólo al armar la lista es la forma natural de mandarle correo a quien acaba de pedir que
 * no le mandaran.
 */
export async function sinLosDeBaja(
  clinicId: string,
  correos: string[],
): Promise<{ permitidos: string[]; excluidos: string[] }> {
  const normalizados = [...new Set(correos.map(normalizarCorreo).filter(Boolean))]
  if (normalizados.length === 0) return { permitidos: [], excluidos: [] }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("owner_email_optout")
    .select("email")
    .eq("clinic_id", clinicId)
    .in("email", normalizados)

  // ANTE LA DUDA, NO SE MANDA. Si la consulta falla no se puede saber quién se dio de baja, y
  // seguir de largo sería mandarle a todos "porque no pudimos comprobarlo".
  if (error) return { permitidos: [], excluidos: normalizados }

  const baja = new Set((data ?? []).map((f) => normalizarCorreo((f as { email: string }).email)))
  return {
    permitidos: normalizados.filter((c) => !baja.has(c)),
    excluidos: normalizados.filter((c) => baja.has(c)),
  }
}

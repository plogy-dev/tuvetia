// A quién puede escribirle ATHOS por WhatsApp. Al vet no se le limita nada.
//
// ── LA REGLA, EN UNA LÍNEA ──────────────────────────────────────────────────────────────────────
//
// El WhatsApp es de la clínica: **el veterinario le escribe a quien quiera**. Athos, no — Athos sólo
// a titulares registrados **o a números que le hayan escrito a la clínica**.
//
// ── POR QUÉ SE ABRIÓ A «QUIEN HAYA ESCRITO» (28-ago, pedido del cliente) ────────────────────────
//
// «Que le responda a todo el mundo siempre y cuando estén activas las comunicaciones.» Y tiene
// razón para el caso que importa: un cliente NUEVO que le escribe a la clínica preguntando el
// horario no está cargado como titular todavía — con la regla vieja, el modo automático redactaba
// la respuesta y la guarda la tiraba a la basura. El desconocido quedaba en visto, que es la peor
// primera impresión posible para el negocio.
//
// Lo que NO cambia es lo que motivó la guarda: RESPONDER no es INICIAR. El número de un entrante
// se legitimó solo — esa persona le escribió a la clínica. El peligro del incidente era el otro
// camino: un payload torcido eligiendo números de la nada. Ese camino sigue cerrado: un número que
// jamás escribió sigue exigiendo estar cargado como titular.
//
// ── POR QUÉ ─────────────────────────────────────────────────────────────────────────────────────
//
// El número que Athos usa sale del payload de su tool `send_whatsapp_message`. Sin cerco, un prompt
// torcido o un titular mal emparejado alcanza para que le escriba a cualquiera de la agenda del
// teléfono. Felipe lo contó en la reunión del 21-ago: *"le metí una gente en su WhatsApp y empezó a
// escribir a la loca, casi me despiden"*.
//
// Limitar al VET sería otra cosa distinta y estaría mal: es su número y su cliente. Una veterinaria
// que no puede responderle a alguien porque todavía no lo cargó en el CRM no tiene una app segura,
// tiene una app rota.
//
// ── EL ORIGEN SE DECLARA, NO SE ADIVINA ─────────────────────────────────────────────────────────
//
// Lo natural sería mirar `sentBy`: si hay un usuario, lo mandó una persona. NO SIRVE, y es la
// trampa de todo esto: `api/athos/actions/[id]/execute` envía con `sentBy: <id del vet que aprueba>`
// aunque **el número lo haya elegido Athos** en el payload propuesto. Con esa heurística, la vía de
// riesgo pasaría por humana.
//
// Por eso cada llamador DECLARA el origen, y el valor por defecto es `"athos"`: quien agregue un
// sexto camino de salida y se olvide del parámetro se lo encuentra restringido, no abierto. Un
// olvido tiene que fallar del lado seguro.
//
// ── SE COMPARAN LOS ÚLTIMOS 10 DÍGITOS ──────────────────────────────────────────────────────────
//
// El mismo número vive escrito de cuatro formas: `+57 324 466 9300` en `owners.phone` (36 de 41 con
// formato, medido), dígitos pelados en `wa_phone_from`, con y sin indicativo. Comparar exacto haría
// que Athos no pudiera escribirle a un titular REAL por un espacio.

import type { SupabaseClient } from "@supabase/supabase-js"

import { ErrorQueElVetPuedeResolver } from "./error-de-envio"

/**
 * Quién eligió el número de destino.
 *
 * `"humano"` = una persona lo tecleó o lo eligió de la bandeja. `"athos"` = salió de un payload del
 * agente, aunque después un vet haya apretado aprobar.
 */
export type OrigenDelEnvio = "humano" | "athos"

/** Cuántos dígitos finales identifican al número. Ver el comentario de arriba. */
const DIGITOS_QUE_IDENTIFICAN = 10

/** Tope de titulares que se traen para comparar. Una clínica normal está muy por debajo. */
const TOPE_TITULARES = 2000

/**
 * La clave con la que se compara un teléfono: sus últimos 10 dígitos.
 *
 * Devuelve `""` para lo que no tiene suficientes dígitos — y un `""` NUNCA coincide con nada, así
 * que un teléfono basura no abre la puerta por accidente.
 */
export function claveDeTelefono(valor: string | null | undefined): string {
  const digitos = (valor ?? "").replace(/\D/g, "")
  return digitos.length >= DIGITOS_QUE_IDENTIFICAN ? digitos.slice(-DIGITOS_QUE_IDENTIFICAN) : ""
}

/**
 * ¿El destino está entre los registrados?
 *
 * Puro, para poder probar la regla sin base. Los `registrados` son teléfonos crudos, tal como salen
 * de la base: los normaliza esta función.
 */
export function esDestinoRegistrado(destino: string, registrados: Iterable<string>): boolean {
  const clave = claveDeTelefono(destino)
  if (!clave) return false
  for (const r of registrados) if (claveDeTelefono(r) === clave) return true
  return false
}

/** Lo que se lanza cuando Athos apunta a un número que no está en la clínica. */
export class DestinoNoRegistrado extends ErrorQueElVetPuedeResolver {
  readonly destino: string
  constructor(destino: string) {
    super(
      "Athos sólo puede escribirle a titulares registrados o a números que le hayan escrito a la " +
        "clínica, y ese número no es ninguna de las dos cosas. Cargalo como titular y volvé a " +
        "intentar — o escribile vos desde la bandeja.",
      400,
    )
    this.name = "DestinoNoRegistrado"
    this.destino = destino
  }
}

/**
 * ¿Athos puede escribirle a este número?
 *
 * Dos puertas, y con UNA alcanza:
 *
 *  1. Es un titular registrado. Se traen los teléfonos y se comparan normalizados: `owners.phone`
 *     viene con formato en la mayoría de los casos, así que no se puede filtrar en SQL sin
 *     normalizar la columna primero — y eso es una migración, no una guarda.
 *  2. Ese número LE ESCRIBIÓ a la clínica alguna vez (hay un entrante suyo en
 *     `whatsapp_messages`). Acá sí se filtra en SQL: `wa_phone_from` guarda dígitos pelados, así
 *     que un `ilike` por los últimos 10 es exacto. Y se consulta la BASE, no se le cree al
 *     llamador: un "es una respuesta" declarado en un parámetro sería un agujero — cualquier
 *     payload podría declararlo.
 *
 * El orden es el barato primero cuando hay pocos titulares, pero se resuelven en paralelo: son dos
 * lecturas chicas y este camino corre dentro del webhook.
 */
export async function athosPuedeEscribirA(
  admin: SupabaseClient,
  clinicId: string,
  destino: string,
): Promise<boolean> {
  const clave = claveDeTelefono(destino)
  if (!clave) return false

  const [{ data: titulares }, { data: entrante }] = await Promise.all([
    admin
      .from("owners")
      .select("phone")
      .eq("clinic_id", clinicId)
      .not("phone", "is", null)
      .limit(TOPE_TITULARES),
    admin
      .from("whatsapp_messages")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("direction", "inbound")
      .ilike("wa_phone_from", `%${clave}`)
      .limit(1)
      .maybeSingle(),
  ])

  if (entrante) return true
  return esDestinoRegistrado(
    destino,
    ((titulares as { phone: string | null }[] | null) ?? []).map((o) => o.phone ?? ""),
  )
}

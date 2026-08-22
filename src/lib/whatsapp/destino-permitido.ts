// A quién PUEDE escribirle la clínica por WhatsApp.
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────────────────────────
//
// Athos tiene una tool `send_whatsapp_message` y el número de destino sale de su payload. Sin una
// guarda, un prompt torcido —o un titular mal emparejado— alcanza para que le escriba a cualquiera
// de la agenda del teléfono. Felipe lo contó de primera mano en la reunión del 21-ago: *"le metí
// una gente en su WhatsApp y empezó a escribir a la loca, casi me despiden"*. Acordado ahí mismo:
// **sólo los números registrados como pacientes**.
//
// Y NO ES HIPOTÉTICO. Medido contra el principal el 22-ago: de 3.472 salientes históricos, **273
// fueron a 29 números que no son titulares, nunca escribieron a la clínica y no llevan `owner_id`**
// — todos de Athos, en tres semanas, en dos clínicas.
//
// ── LA REGLA, Y POR QUÉ NO ES "SÓLO TITULARES" ──────────────────────────────────────────────────
//
// "Sólo titulares" suena a lo que se pidió y habría roto el producto: bloquearía **3.426 de 3.472**
// (98,7%). La razón es que el grueso del tráfico legítimo es responderle a alguien que escribió
// primero y todavía no está cargado como titular — que es exactamente lo que hace una bandeja.
//
// Vale el destino si:
//
//   (a) es TITULAR de la clínica, o
//   (b) YA ESCRIBIÓ a la clínica.
//
// Con eso pasan los 3.199 legítimos y quedan bloqueados los 273 de riesgo.
//
// ── SIN EXCEPCIÓN PARA HUMANOS, Y ES LO MENOS OBVIO ─────────────────────────────────────────────
//
// La tentación es dejar pasar lo que manda una persona y guardar sólo a Athos. No sirve:
// `api/athos/actions/[id]/execute` envía con `sentBy: <id del vet que aprueba>` aunque **el número
// lo haya elegido Athos** en el payload propuesto. O sea que `sentBy` no distingue "un humano
// tecleó este número" de "Athos lo propuso y alguien hizo clic en aprobar" — y esa segunda es
// justamente la vía de riesgo. La guarda corre para todos.
//
// ── SE COMPARAN LOS ÚLTIMOS 10 DÍGITOS ──────────────────────────────────────────────────────────
//
// Y no la cadena completa, porque el mismo número vive escrito de cuatro formas: `+57 324 466 9300`
// en `owners.phone` (36 de 41 con formato), dígitos pelados en `wa_phone_from`, con y sin
// indicativo. Comparar exacto haría que la guarda bloqueara titulares REALES por un espacio.
//
// Es deliberadamente el lado indulgente: dos países podrían compartir un sufijo de 10 dígitos, y en
// ese caso improbable la guarda deja pasar en vez de bloquear. Se elige así porque esto no es una
// frontera criptográfica — es un cerco para que el agente no salga de la lista de gente con la que
// la clínica ya tiene relación. Bloquear a un cliente real de una veterinaria es un daño seguro;
// el colisión de sufijos es un riesgo remoto que además exige que alguien ya esté en la agenda.

import type { SupabaseClient } from "@supabase/supabase-js"

import { ErrorQueElVetPuedeResolver } from "./error-de-envio"

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
 * ¿El destino está entre los conocidos?
 *
 * Puro, para poder probar la regla sin base. Los `conocidos` son teléfonos crudos, tal como salen
 * de la base: los normaliza esta función.
 */
export function esDestinoConocido(destino: string, conocidos: Iterable<string>): boolean {
  const clave = claveDeTelefono(destino)
  if (!clave) return false
  for (const c of conocidos) if (claveDeTelefono(c) === clave) return true
  return false
}

/** Lo que se lanza cuando el destino no pasa. Extiende el error que la UI sabe mostrar. */
export class DestinoNoRegistrado extends ErrorQueElVetPuedeResolver {
  readonly destino: string
  constructor(destino: string) {
    super(
      "Ese número no está registrado en la clínica y nunca escribió, así que no se le puede " +
        "enviar un WhatsApp. Si es un cliente, cargalo primero como titular.",
      400,
    )
    this.name = "DestinoNoRegistrado"
    this.destino = destino
  }
}

/**
 * ¿Se le puede escribir a este número?
 *
 * PRIMERO LOS ENTRANTES y después los titulares, y el orden no es casual: el 91% del tráfico
 * legítimo es una respuesta a alguien que escribió, y esa comprobación es una consulta acotada
 * —`wa_phone_from` se guarda en dígitos puros, verificado: 3.404 de 3.404— mientras que la de
 * titulares tiene que traerse las filas y normalizar en memoria porque los teléfonos vienen con
 * formato. Se paga la cara sólo cuando la barata no alcanzó.
 */
export async function puedeRecibirWhatsApp(
  admin: SupabaseClient,
  clinicId: string,
  destino: string,
): Promise<boolean> {
  const clave = claveDeTelefono(destino)
  if (!clave) return false

  // (b) ¿Ya escribió? `like` por sufijo: el campo son dígitos, así que el sufijo ES el número.
  const { data: entrante } = await admin
    .from("whatsapp_messages")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("direction", "inbound")
    .like("wa_phone_from", `%${clave}`)
    .limit(1)
    .maybeSingle()
  if (entrante) return true

  // (a) ¿Es titular? Se traen los teléfonos de la clínica y se comparan normalizados.
  const { data: titulares } = await admin
    .from("owners")
    .select("phone")
    .eq("clinic_id", clinicId)
    .not("phone", "is", null)
    .limit(TOPE_TITULARES)
  return esDestinoConocido(
    destino,
    ((titulares as { phone: string | null }[] | null) ?? []).map((o) => o.phone ?? ""),
  )
}

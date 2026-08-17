import { createAdminClient } from "@/lib/supabase/admin"
import { configWompi } from "@/lib/wompi/config"
import { eventoEsAutentico, type EventoWompi } from "@/lib/wompi/firma"
import { aplicarResultado } from "@/lib/suscripcion/motor"

// EL WEBHOOK DE WOMPI. La única fuente de verdad sobre si un pago salió.
//
// ── POR QUÉ NO ALCANZA CON LA RESPUESTA DEL COBRO ──────────────────────────────────────────────
//
// `POST /transactions` responde `PENDING` casi siempre: el resultado real llega acá, segundos o
// minutos después. Y la redirección del navegador tampoco sirve — cualquiera puede visitar la URL
// de retorno con el id que se le ocurra. Esto es lo único firmado por Wompi.
//
// ── ESTA URL ES PÚBLICA ────────────────────────────────────────────────────────────────────────
//
// No hay sesión ni `CRON_SECRET` que la proteja: Wompi no manda credenciales. Lo que la protege es
// el checksum, y por eso **un evento sin firma válida se guarda pero no se aplica**. Sin esa regla,
// cualquiera que conozca la URL podría regalarse el plan Pro mandando un JSON con
// `status: APPROVED`.
//
// ── SIEMPRE 200, INCLUSO CUANDO SE RECHAZA ─────────────────────────────────────────────────────
//
// Wompi reintenta ante cualquier respuesta que no sea 2xx. Devolver 400 a un evento con firma mala
// invita a que lo reintenten indefinidamente, y devolver 500 a uno que no supimos procesar hace lo
// mismo con un evento que nunca vamos a poder procesar. Se responde 200 y se deja el registro en
// `suscripcion_eventos`, que es donde se mira lo que pasó.
//
// La única excepción es un cuerpo que ni siquiera es JSON: ahí sí, 400, porque no hay nada que
// registrar y no es un evento de Wompi.

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const crudo = await req.text()

  let evento: EventoWompi
  try {
    evento = JSON.parse(crudo) as EventoWompi
  } catch {
    return new Response("Cuerpo inválido", { status: 400 })
  }

  const cfg = configWompi()
  if (!cfg.ok) {
    // Sin secreto de eventos no se puede validar NADA, así que no se aplica NADA. Un webhook que
    // acepta a ciegas porque le falta una variable es peor que uno caído.
    console.error("wompi/webhook: llegó un evento y la integración no está configurada:", cfg.motivo)
    return new Response("OK", { status: 200 })
  }

  const transaccionId =
    (evento.data as { transaction?: { id?: string } } | undefined)?.transaction?.id ?? null

  const firmaValida = eventoEsAutentico(
    evento,
    cfg.config.secretoEventos,
    req.headers.get("x-event-checksum"),
  )

  // ── Se registra SIEMPRE, válido o no ─────────────────────────────────────────────────────────
  // Un evento con firma mala es precisamente el que hay que poder mirar después: o alguien está
  // probando la URL, o rotaron el secreto y nadie actualizó la variable. Las dos cosas se
  // diagnostican leyendo esta tabla y ninguna se ve si el evento se descarta en silencio.
  const db = createAdminClient()
  const { data: fila } = await db
    .from("suscripcion_eventos")
    .insert({
      evento: evento.event ?? null,
      wompi_transaction_id: transaccionId,
      firma_valida: firmaValida,
      payload: evento as unknown as Record<string, unknown>,
    })
    .select("id")
    .single()

  if (!firmaValida) {
    console.error("wompi/webhook: checksum inválido", { evento: evento.event, transaccionId })
    return new Response("OK", { status: 200 })
  }

  if (evento.event !== "transaction.updated" || !transaccionId) {
    // Los otros eventos de Wompi (tokens de Nequi y de Bancolombia) no nos aplican: la suscripción
    // es con tarjeta. Quedan registrados y no se procesan.
    return new Response("OK", { status: 200 })
  }

  const estado = (evento.data as { transaction?: { status?: string } }).transaction?.status ?? ""
  const mensaje =
    (evento.data as { transaction?: { status_message?: string | null } }).transaction?.status_message ?? null

  try {
    const res = await aplicarResultado({ transaccionId, estadoWompi: estado, mensaje })

    if (fila) {
      await db
        .from("suscripcion_eventos")
        .update({ procesado_en: new Date().toISOString() })
        .eq("id", (fila as { id: string }).id)
    }

    if (!res.aplicado) {
      // No es un fallo: es el caso normal de un reintento de Wompi sobre un evento ya aplicado.
      console.info(`wompi/webhook: evento no aplicado (${res.motivo})`, transaccionId)
    }
  } catch (e) {
    // El evento ya quedó guardado con `procesado_en` en null, así que se puede reprocesar a mano.
    console.error("wompi/webhook: falló al aplicar el resultado", e)
  }

  return new Response("OK", { status: 200 })
}

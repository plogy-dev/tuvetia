import "server-only"

// LA RED PARA CUANDO EL WEBHOOK NO LLEGA.
//
// ── POR QUÉ EXISTE, Y NO ES HIPOTÉTICO ─────────────────────────────────────────────────────────
//
// El 2026-08-17, en la primera prueba real contra sandbox: Wompi aprobó el cobro en un segundo y el
// webhook nunca llegó (la URL de eventos no estaba guardada). El cobro quedó `PENDIENTE` para
// siempre y la clínica se quedó **pagando y sin su plan**, sin ninguna alerta. Hubo que destrabarlo
// a mano contra la base.
//
// Con cobros mensuales automáticos eso es peor: el cobro sale a las 9 de la mañana sin nadie
// delante. Si el webhook se pierde ahí, no hay ninguna persona mirando una pantalla de pago que se
// dé cuenta. **Un sistema de cobro no puede depender de que un POST llegue.**
//
// ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────
//
// Busca los cobros que llevan rato en `PENDIENTE`, le pregunta a Wompi por el estado REAL de cada
// transacción y aplica el resultado con el mismo `aplicarResultado` que usa el webhook — que ya es
// idempotente, así que si el webhook llega tarde no pasa nada dos veces.
//
// ── LO QUE NO CUBRE, Y HAY QUE SABERLO ─────────────────────────────────────────────────────────
//
// Sólo reconcilia los cobros que TIENEN `wompi_transaction_id`. Queda afuera el caso en que la
// llamada a Wompi se cortó antes de devolvernos el id: ahí el cobro pudo haberse ejecutado y no
// tenemos con qué preguntarlo.
//
// Wompi expone búsqueda por referencia (`GET /v1/transactions?reference=`), que cerraría el hueco,
// pero requiere la llave privada y **no se pudo verificar la forma de su respuesta** al escribir
// esto. Implementarla a ciegas sería escribir código que falla en silencio justo en el escenario
// para el que existe. Así que esos cobros **no se adivinan: se reportan** en `huerfanos`, para que
// aparezcan en el log del barrido y los mire una persona.

import { createAdminClient } from "@/lib/supabase/admin"
import { consultarTransaccion } from "@/lib/wompi/api"
import { aplicarResultado } from "@/lib/suscripcion/motor"

/**
 * Cuánto se espera antes de dar por perdido un webhook.
 *
 * 15 minutos, no 1: el camino normal es que el webhook llegue en segundos, y preguntarle a Wompi
 * por una transacción que todavía está resolviéndose es gastar llamadas para recibir `PENDING`.
 * Tampoco horas: cada minuto de más es un minuto en que alguien pagó y no tiene lo que compró.
 */
const MINUTOS_DE_GRACIA = 15

/** Techo por corrida. Contención, no límite de negocio. */
const TOPE = 50

export type ResultadoReconciliacion = {
  revisados: number
  resueltos: number
  siguenPendientes: number
  /** Cobros sin `wompi_transaction_id`: no se pueden consultar. Necesitan una persona. */
  huerfanos: { cobroId: string; referencia: string; creado: string }[]
}

export async function reconciliarCobrosColgados(
  ahora = new Date(),
): Promise<ResultadoReconciliacion> {
  const db = createAdminClient()
  const res: ResultadoReconciliacion = {
    revisados: 0,
    resueltos: 0,
    siguenPendientes: 0,
    huerfanos: [],
  }

  const corte = new Date(ahora.getTime() - MINUTOS_DE_GRACIA * 60_000).toISOString()

  const { data, error } = await db
    .from("suscripcion_cobros")
    .select("id, referencia, wompi_transaction_id, created_at")
    .eq("estado", "PENDIENTE")
    .lt("created_at", corte)
    .order("created_at", { ascending: true })
    .limit(TOPE)

  if (error) {
    console.error("suscripcion/reconciliar: no se pudieron listar los cobros colgados", error)
    return res
  }

  const colgados = (data ?? []) as {
    id: string
    referencia: string
    wompi_transaction_id: string | null
    created_at: string
  }[]
  res.revisados = colgados.length

  for (const cobro of colgados) {
    if (!cobro.wompi_transaction_id) {
      // Ver la nota de arriba: sin id no hay nada que preguntar. Se reporta, no se adivina.
      res.huerfanos.push({
        cobroId: cobro.id,
        referencia: cobro.referencia,
        creado: cobro.created_at,
      })
      continue
    }

    try {
      const tx = await consultarTransaccion(cobro.wompi_transaction_id)
      if (!tx.ok) {
        console.error(
          `suscripcion/reconciliar: no se pudo consultar ${cobro.wompi_transaction_id}: ${tx.mensaje}`,
        )
        continue
      }

      if (tx.data.status === "PENDING") {
        // Legítimamente sin resolver todavía. Se vuelve a mirar mañana.
        res.siguenPendientes += 1
        continue
      }

      // El mismo camino que el webhook, y es a propósito: `aplicarResultado` es idempotente y sólo
      // actúa si el cobro sigue en PENDIENTE, así que un webhook que llegue tarde no duplica nada.
      const aplicado = await aplicarResultado({
        transaccionId: cobro.wompi_transaction_id,
        estadoWompi: tx.data.status,
        mensaje: tx.data.status_message ?? null,
      })

      if (aplicado.aplicado) {
        res.resueltos += 1
        console.warn(
          `suscripcion/reconciliar: cobro ${cobro.referencia} resuelto como ${tx.data.status} ` +
            `SIN webhook. Revisá la URL de eventos en Wompi.`,
        )
      }
    } catch (e) {
      console.error(`suscripcion/reconciliar: excepción con ${cobro.referencia}`, e)
    }
  }

  // Los huérfanos son el único caso que necesita a un humano, así que gritan.
  if (res.huerfanos.length) {
    console.error(
      `suscripcion/reconciliar: ${res.huerfanos.length} cobro(s) sin id de transacción. ` +
        `Pudieron haberse cobrado y no lo sabemos — buscalos en el panel de Wompi por referencia: ` +
        res.huerfanos.map((h) => h.referencia).join(", "),
    )
  }

  return res
}

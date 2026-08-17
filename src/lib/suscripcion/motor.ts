import "server-only"

// EL MOTOR DE LA SUSCRIPCIÓN. Lo que Wompi no hace.
//
// Wompi no tiene producto de suscripciones: no hay planes, ni ciclos, ni reintentos, ni portal de
// cliente. Lo único que da es una fuente de pago reutilizable y un endpoint para cobrarle. **Todo
// el ciclo de vida es nuestro**, y vive acá.
//
// ── LA REGLA QUE SOSTIENE TODO: EL WEBHOOK MANDA ───────────────────────────────────────────────
//
// `POST /transactions` casi siempre responde `PENDING`. La respuesta inmediata NO es el resultado:
// el resultado llega por webhook, segundos o minutos después. Por eso acá nadie da un plan por
// activado al recibir la respuesta del cobro — se escribe el intento y se espera.
//
// De ahí salen dos consecuencias que parecen rarezas y no lo son:
//
//   1. **La fila del cobro se escribe ANTES de llamar a Wompi.** Si la llamada se cae a mitad de
//      camino, el cobro pudo haberse ejecutado igual. Con la fila ya escrita, el webhook la
//      encuentra por referencia y la cierra. Al revés —escribir después— un timeout dejaría plata
//      cobrada sin ningún registro nuestro, que es el peor estado posible.
//   2. **Un fallo de red NO se trata como rechazo.** Se deja `PENDIENTE`. Reintentar dando por
//      fallido algo que quizás se cobró es cómo se cobra dos veces.
//
// ── IDEMPOTENCIA ───────────────────────────────────────────────────────────────────────────────
//
// La referencia (`tuvetia-<clinica>-<YYYY-MM>-<intento>`) es única en nuestra tabla Y en Wompi, que
// rechaza referencias repetidas. Dos lambdas del cron corriendo a la vez chocan contra el `unique`
// y sólo una cobra.

import { createAdminClient } from "@/lib/supabase/admin"
import { cobrarAFuenteDePago } from "@/lib/wompi/api"
import { referenciaDeCobro } from "@/lib/wompi/firma"
import { precioProCentavos } from "@/lib/planes/precio"
import {
  MAX_INTENTOS,
  diasHastaProximoIntento,
  etiquetaDePeriodo,
  soloFecha,
  unMesDespues,
} from "@/lib/suscripcion/periodo"

type Cliente = ReturnType<typeof createAdminClient>

/** Lo que el motor necesita saber de una clínica para cobrarle. */
export type ClinicaCobrable = {
  id: string
  wompi_payment_source_id: number | null
  wompi_customer_email: string | null
  plan_renueva_en: string | null
  subscription_status: string
}

export type ResultadoCobro =
  | { ok: true; cobroId: string; transaccionId: string | null; estado: string }
  | { ok: false; motivo: string }

/**
 * Qué período le toca pagar a esta clínica, y qué número de intento es.
 *
 * SE DERIVA DEL ÚLTIMO COBRO APROBADO, no de `plan_renueva_en`. Parece una vuelta larga y es lo que
 * hace que los reintentos no corran el ciclo: si el cobro de septiembre falla el día 1 y sale el
 * día 5, el período sigue siendo 1-sep → 1-oct y el próximo cobro es el 1 de octubre. Anclando el
 * período a la fecha del intento, cada rechazo le regalaría días al cliente y el ciclo se
 * desplazaría para siempre.
 *
 * El intento sale de contar las filas del MISMO período. Así la referencia nunca se repite y el
 * historial muestra "septiembre, intento 2" en vez de dos filas indistinguibles.
 */
async function periodoACobrar(
  db: Cliente,
  clinicId: string,
  ahora: Date,
): Promise<{ inicio: Date; fin: Date; etiqueta: string; intento: number }> {
  const { data: ultimoAprobado } = await db
    .from("suscripcion_cobros")
    .select("periodo_fin")
    .eq("clinic_id", clinicId)
    .eq("estado", "APROBADO")
    .order("periodo_fin", { ascending: false })
    .limit(1)
    .maybeSingle()

  const finAnterior = (ultimoAprobado as { periodo_fin: string | null } | null)?.periodo_fin
  // Sin cobro aprobado previo, el período arranca ahora: es un alta.
  const inicio = finAnterior ? new Date(`${finAnterior}T00:00:00.000Z`) : ahora
  const fin = unMesDespues(inicio)
  const etiqueta = etiquetaDePeriodo(inicio)

  const { count } = await db
    .from("suscripcion_cobros")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("periodo_inicio", soloFecha(inicio))

  return { inicio, fin, etiqueta, intento: (count ?? 0) + 1 }
}

/**
 * Cobra un período a una clínica que ya tiene tarjeta guardada.
 *
 * NO ACTIVA EL PLAN. Sólo deja el intento hecho y registrado; quien mueve el plan es
 * `aplicarResultado`, cuando el webhook confirma. Es la misma función para el alta y para la
 * renovación: el `motivo` sólo cambia lo que se guarda para el historial.
 */
export async function cobrarPeriodo(params: {
  clinica: ClinicaCobrable
  motivo: "alta" | "renovacion" | "reintento"
  ahora?: Date
}): Promise<ResultadoCobro> {
  const { clinica, motivo } = params
  const ahora = params.ahora ?? new Date()
  const db = createAdminClient()

  if (!clinica.wompi_payment_source_id || !clinica.wompi_customer_email) {
    return { ok: false, motivo: "La clínica no tiene un medio de pago guardado." }
  }

  const periodo = await periodoACobrar(db, clinica.id, ahora)
  if (periodo.intento > MAX_INTENTOS) {
    return { ok: false, motivo: `Ya se agotaron los ${MAX_INTENTOS} intentos de este período.` }
  }

  const monto = precioProCentavos()
  const referencia = referenciaDeCobro({
    clinicId: clinica.id,
    periodo: periodo.etiqueta,
    intento: periodo.intento,
  })

  // ── La fila primero, la llamada después ──────────────────────────────────────────────────────
  const { data: cobro, error: errorCobro } = await db
    .from("suscripcion_cobros")
    .insert({
      clinic_id: clinica.id,
      referencia,
      monto_centavos: monto,
      moneda: "COP",
      estado: "PENDIENTE",
      motivo,
      intento: periodo.intento,
      periodo_inicio: soloFecha(periodo.inicio),
      periodo_fin: soloFecha(periodo.fin),
    })
    .select("id")
    .single()

  if (errorCobro || !cobro) {
    // El choque contra el `unique` de la referencia entra por acá, y NO es un error: significa que
    // otro proceso ya está cobrando este mismo período e intento. Dejarlo pasar en silencio es lo
    // correcto — cobrar de nuevo sería el error.
    if (errorCobro?.code === "23505") {
      return { ok: false, motivo: "Ese cobro ya estaba en curso." }
    }
    console.error("suscripcion/motor: no se pudo registrar el cobro", errorCobro)
    return { ok: false, motivo: "No se pudo registrar el cobro." }
  }

  const cobroId = (cobro as { id: string }).id

  const res = await cobrarAFuenteDePago({
    fuenteDePagoId: clinica.wompi_payment_source_id,
    correo: clinica.wompi_customer_email,
    montoCentavos: monto,
    referencia,
  })

  if (!res.ok) {
    // SE QUEDA EN `PENDIENTE`, a propósito. Un fallo de red no dice que el cobro no se hizo: dice
    // que no sabemos. El webhook lo resolverá si se ejecutó; si no llega, queda visible en la tabla
    // como pendiente viejo, que es un estado que se puede auditar. Marcarlo ERROR acá haría que el
    // reintento cobrara de nuevo algo posiblemente ya cobrado.
    await db.from("suscripcion_cobros").update({ wompi_mensaje: res.mensaje, updated_at: new Date().toISOString() }).eq("id", cobroId)
    return { ok: false, motivo: res.mensaje }
  }

  await db
    .from("suscripcion_cobros")
    .update({
      wompi_transaction_id: res.data.id,
      wompi_estado: res.data.status,
      wompi_mensaje: res.data.status_message ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cobroId)

  // Wompi puede resolver en el acto (raro, pero pasa con algunos rechazos). Si ya vino un estado
  // final, se aplica sin esperar al webhook — y si el webhook llega después, `aplicarResultado` es
  // idempotente y no hace nada dos veces.
  if (res.data.status !== "PENDING") {
    await aplicarResultado({
      transaccionId: res.data.id,
      estadoWompi: res.data.status,
      mensaje: res.data.status_message ?? null,
    })
  }

  return { ok: true, cobroId, transaccionId: res.data.id, estado: res.data.status }
}

// ── Aplicar el resultado ───────────────────────────────────────────────────────────────────────

/** Traduce el estado de Wompi al de nuestra tabla. */
function estadoInterno(estadoWompi: string): "APROBADO" | "RECHAZADO" | "ERROR" | "ANULADO" | null {
  switch (estadoWompi) {
    case "APPROVED":
      return "APROBADO"
    case "DECLINED":
      return "RECHAZADO"
    case "VOIDED":
      return "ANULADO"
    case "ERROR":
      return "ERROR"
    default:
      // PENDING y cualquier estado nuevo: no es final, no se aplica nada.
      return null
  }
}

/**
 * Mueve el plan de la clínica según cómo terminó un cobro.
 *
 * **ES IDEMPOTENTE Y TIENE QUE SERLO.** Wompi reintenta los webhooks, y el mismo evento puede
 * llegar tres veces. El corte está en el `estado` de la fila: si ya no es `PENDIENTE`, el resultado
 * ya se aplicó y no se vuelve a tocar. Sin esa guarda, tres entregas del evento de aprobación
 * sumarían tres meses de suscripción.
 */
export async function aplicarResultado(params: {
  transaccionId: string
  estadoWompi: string
  mensaje?: string | null
}): Promise<{ aplicado: boolean; motivo?: string }> {
  const db = createAdminClient()
  const estado = estadoInterno(params.estadoWompi)
  if (!estado) return { aplicado: false, motivo: "Estado no final; no hay nada que aplicar." }

  const { data: fila } = await db
    .from("suscripcion_cobros")
    .select("id, clinic_id, estado, intento, periodo_fin")
    .eq("wompi_transaction_id", params.transaccionId)
    .maybeSingle()

  const cobro = fila as {
    id: string
    clinic_id: string
    estado: string
    intento: number
    periodo_fin: string | null
  } | null

  if (!cobro) {
    // Un evento de una transacción que no conocemos. Puede ser de otra integración que comparta la
    // misma cuenta de Wompi. No es un error nuestro y no se toca nada.
    return { aplicado: false, motivo: "No hay un cobro nuestro con esa transacción." }
  }

  if (cobro.estado !== "PENDIENTE") {
    return { aplicado: false, motivo: "Ese cobro ya estaba resuelto." }
  }

  await db
    .from("suscripcion_cobros")
    .update({
      estado,
      wompi_estado: params.estadoWompi,
      wompi_mensaje: params.mensaje ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cobro.id)
    // La condición de carrera real: dos entregas del webhook a la vez. Sólo una encuentra la fila
    // todavía en PENDIENTE.
    .eq("estado", "PENDIENTE")

  if (estado === "APROBADO") {
    await activarPro(db, cobro.clinic_id, cobro.periodo_fin)
  } else {
    await manejarRechazo(db, cobro.clinic_id, cobro.intento)
  }

  return { aplicado: true }
}

/** Pago bueno: Pro hasta el fin del período cobrado. */
async function activarPro(db: Cliente, clinicId: string, periodoFin: string | null) {
  await db
    .from("clinics")
    .update({
      plan: "pro",
      subscription_status: "active",
      plan_renueva_en: periodoFin ? `${periodoFin}T00:00:00.000Z` : null,
      // Un pago exitoso levanta la cancelación: quien canceló y volvió a pagar quiere seguir.
      plan_cancelado_en: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clinicId)
}

/**
 * Pago rechazado.
 *
 * **NO BAJA EL PLAN TODAVÍA.** Quedan `past_due` y con Pro puesto hasta agotar los intentos, que es
 * el período de gracia de 6 días. El caso común de un rechazo no es alguien que se fue: es una
 * tarjeta vencida. Cortar el Modo Fantasma en medio de una consulta por un cobro que falló esta
 * mañana es la peor manera posible de pedir que actualicen la tarjeta.
 */
async function manejarRechazo(db: Cliente, clinicId: string, intentoQueFallo: number) {
  const dias = diasHastaProximoIntento(intentoQueFallo)

  if (dias === null) {
    await db
      .from("clinics")
      .update({
        plan: "free",
        subscription_status: "inactive",
        plan_renueva_en: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", clinicId)
    return
  }

  const proximo = new Date(Date.now() + dias * 86_400_000)
  await db
    .from("clinics")
    .update({
      subscription_status: "past_due",
      // `plan_renueva_en` pasa a ser "cuándo reintentamos". Es la misma columna que mira el cron, y
      // por eso el reintento no necesita ninguna maquinaria aparte.
      plan_renueva_en: proximo.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", clinicId)
}

// ── Cancelación ────────────────────────────────────────────────────────────────────────────────

/**
 * Cancela la renovación.
 *
 * **NO BAJA EL PLAN EN EL ACTO.** Se marca la cancelación y la clínica sigue en Pro hasta que
 * termine el mes que ya pagó. Cortar el día que alguien cancela es quedarse con plata por un
 * servicio que no se prestó, y además empuja a que la gente cancele el último día por miedo a
 * perder los días que le quedan.
 *
 * Quien la baja de verdad es el cron, cuando `plan_renueva_en` vence y ve la marca.
 */
export async function cancelarSuscripcion(clinicId: string): Promise<{ ok: boolean; mensaje: string }> {
  const db = createAdminClient()

  const { data } = await db
    .from("clinics")
    .select("subscription_status, plan_renueva_en")
    .eq("id", clinicId)
    .maybeSingle()

  const c = data as { subscription_status: string; plan_renueva_en: string | null } | null
  if (!c) return { ok: false, mensaje: "No encontramos la clínica." }
  if (c.subscription_status === "canceled") {
    return { ok: true, mensaje: "La suscripción ya estaba cancelada." }
  }
  if (c.subscription_status !== "active" && c.subscription_status !== "past_due") {
    return { ok: false, mensaje: "No hay una suscripción activa que cancelar." }
  }

  await db
    .from("clinics")
    .update({
      subscription_status: "canceled",
      plan_cancelado_en: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", clinicId)

  return { ok: true, mensaje: "Cancelada. Seguís con Pro hasta que termine el período que ya pagaste." }
}

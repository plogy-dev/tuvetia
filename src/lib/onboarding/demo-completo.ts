// La siembra CON VOLUMEN, para que una clínica de demostración se vea como una clínica que opera.
//
// ── POR QUÉ EXISTE, APARTE DE LA SIEMBRA QUE YA HABÍA ──────────────────────────────────────────
//
// La siembra del onboarding (`api/onboarding/demo-data`) crea cinco filas: un titular, un paciente
// y una consulta con su nota. Eso alcanza para lo que fue pensada —enseñar el Modo Fantasma sin
// grabar— y no alcanza para NADA de lo que se mira en una demostración. Medido contra el principal
// el 26-ago, la clínica que el cliente estaba revisando tenía 18 pacientes y CERO facturas, cero
// movimientos de inventario y la meta de ventas en nulo. Con eso: el libro de Ventas vacío, las dos
// donas de plata vacías, el anillo de cumplimiento sin pintar, Cartera vacía, Finanzas vacía y el
// inventario entero en «Agotado». No había nada roto; faltaba contenido.
//
// ── ES OPT-IN, Y ESA ES LA DECISIÓN MÁS IMPORTANTE DE ESTE ARCHIVO ────────────────────────────
//
// El asistente de bienvenida llama a la siembra para TODA clínica nueva. Si la parte comercial
// entrara por ahí, cada clínica real nacería con ventas que nadie hizo — y esas facturas llevan
// consecutivo, quedan en la historia y ensucian los números del primer mes. Por eso esto sólo corre
// cuando alguien lo pide expresamente (`{ completo: true }`), y la siembra de siempre queda intacta.
//
// ── SE SIEMBRA POR LOS CAMINOS DE PRODUCCIÓN, NO A MANO ───────────────────────────────────────
//
// Las facturas se crean y se emiten con `createDraftInvoice` + `issueInvoice`. Insertarlas a pelo
// sería más corto y quedaría MAL: `refreshInvoiceStatus` deriva `paid_cents`, `balance_cents`,
// `collection_status`, `delivery_status` y `followup_status` desde `invoice_events`, así que una
// factura escrita a mano deja la Cartera y las insignias diciendo cosas que no son. Pasando por la
// función de verdad, además, se numera el documento, se escriben sus eventos y se descuenta el
// inventario — que es justamente lo que se quiere mostrar.
//
// Las dos funciones aceptan `now`, así que las fechas se reparten pasándoles el instante que toca:
// no hay que reescribir ninguna fila después de emitirla.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createDraftInvoice, issueInvoice } from "@/lib/facturacion/invoices"
import { ensurePayerForOwner } from "@/lib/facturacion/queries"
import { validateMovementSign } from "@/lib/facturacion/domain/inventory"

/**
 * La marca que identifica TODO lo sembrado, y sin la cual no habría forma de borrarlo.
 *
 * Va en una columna de texto propia de cada fila —no basta con colgar de un titular— porque
 * `invoices`, `catalog_items` e `inventory_movements` NO cuelgan del titular demo: sus claves a
 * paciente y titular son `on delete set null`, así que borrar al titular los dejaría huérfanos y
 * sin manera de encontrarlos.
 *
 * Es el mismo literal que ya usaba la siembra vieja, a propósito: un segundo marcador sería un
 * segundo sitio donde equivocarse.
 */
export const MARCA_DEMO = "Ejemplo — TuvetIA"

/** Prefijo del `sku`. Es la marca en la única columna de texto libre que tiene el catálogo. */
export const SKU_DEMO = "DEMO-"

/**
 * El catálogo que le falta a una clínica de demostración.
 *
 * SON CUATRO TIPOS A PROPÓSITO. La dona «Ventas del mes por tipo» pinta un gajo por `item_type`, y
 * una clínica cuyo catálogo es todo `SERVICIO` —el caso real que motivó esto— produce una dona de
 * un solo color, que es peor que ninguna: parece rota. Con productos, medicamentos e insumos la
 * dona muestra lo que fue diseñada para mostrar.
 *
 * Los precios son de mercado colombiano y en PESOS ENTEROS (ver `aPesosEnteros` en domain/money):
 * el catálogo de la clínica real tenía los ocho ítems a $100, que en pantalla se lee como un error.
 */
export const CATALOGO_DEMO: ReadonlyArray<{
  nombre: string
  tipo: "PRODUCTO" | "MEDICAMENTO" | "INSUMO"
  precioCents: number
  costoCents: number
  ivaPct: number
  existencia: number
}> = [
  { nombre: "Alimento medicado gastrointestinal 2 kg", tipo: "PRODUCTO", precioCents: 9_800_000, costoCents: 6_500_000, ivaPct: 19, existencia: 14 },
  { nombre: "Antipulgas spot-on (pipeta)", tipo: "MEDICAMENTO", precioCents: 4_500_000, costoCents: 2_900_000, ivaPct: 0, existencia: 30 },
  { nombre: "Antibiótico amoxicilina 500 mg (caja)", tipo: "MEDICAMENTO", precioCents: 3_200_000, costoCents: 1_950_000, ivaPct: 0, existencia: 22 },
  { nombre: "Desparasitante interno (tableta)", tipo: "MEDICAMENTO", precioCents: 1_500_000, costoCents: 800_000, ivaPct: 0, existencia: 40 },
  { nombre: "Collar isabelino talla M", tipo: "PRODUCTO", precioCents: 3_500_000, costoCents: 1_800_000, ivaPct: 19, existencia: 9 },
  { nombre: "Jeringa 5 ml estéril", tipo: "INSUMO", precioCents: 120_000, costoCents: 60_000, ivaPct: 19, existencia: 200 },
  { nombre: "Venda de gasa 10 cm", tipo: "INSUMO", precioCents: 450_000, costoCents: 220_000, ivaPct: 19, existencia: 60 },
]

export type ItemSembrado = { id: string; precioCents: number }

/**
 * Crea el catálogo de demostración y le carga existencias.
 *
 * PRIMERO EL CATÁLOGO Y LUEGO EL STOCK, y las facturas DESPUÉS de los dos: emitir descuenta
 * inventario de verdad (`issueInvoice` inserta `SALIDA_VENTA`), así que sembrar al revés dejaría
 * existencias en negativo o cortaría por «existencia insuficiente» si la clínica bloquea eso.
 *
 * Idempotente por su cuenta: si ya hay ítems con el prefijo, no duplica.
 */
export async function sembrarCatalogo(
  admin: SupabaseClient,
  clinicId: string,
  userId: string,
): Promise<ItemSembrado[]> {
  const { data: yaEstan } = await admin
    .from("catalog_items")
    .select("id, price_cents")
    .eq("clinic_id", clinicId)
    .like("sku", `${SKU_DEMO}%`)
  if (yaEstan && yaEstan.length > 0) {
    return (yaEstan as { id: string; price_cents: number }[]).map((i) => ({
      id: i.id,
      precioCents: i.price_cents,
    }))
  }

  const filas = CATALOGO_DEMO.map((i, n) => ({
    clinic_id: clinicId,
    created_by: userId,
    item_type: i.tipo,
    name: i.nombre,
    // El `sku` ES la marca: sin una columna de texto propia, esta fila sería imborrable.
    sku: `${SKU_DEMO}${String(n + 1).padStart(2, "0")}`,
    price_cents: i.precioCents,
    cost_cents: i.costoCents,
    tax_rate: i.ivaPct,
    track_stock: true,
    min_stock: 5,
    active: true,
  }))

  const { data: creados, error } = await admin
    .from("catalog_items")
    .insert(filas)
    .select("id, price_cents, sku")
  if (error) throw new Error(`catálogo de ejemplo: ${error.message}`)

  const items = (creados as { id: string; price_cents: number; sku: string }[]) ?? []

  // La existencia NO es una columna: es la suma de los movimientos. Sin una carga inicial, cada
  // ítem nace «Agotado» y el inventario se ve igual de vacío que antes.
  const movimientos = items.map((it) => {
    const receta = CATALOGO_DEMO[Number(it.sku.slice(SKU_DEMO.length)) - 1]
    const qty = receta?.existencia ?? 10
    // La misma validación de signo que usa el alta manual, para no inventar un camino distinto.
    validateMovementSign({ qty, type: "CARGA_INICIAL" })
    return {
      clinic_id: clinicId,
      created_by: userId,
      item_id: it.id,
      qty,
      movement_type: "CARGA_INICIAL" as const,
      ref_type: "MANUAL" as const,
      note: `${MARCA_DEMO} — carga inicial de demostración`,
    }
  })
  const { error: mErr } = await admin.from("inventory_movements").insert(movimientos)
  if (mErr) throw new Error(`existencias de ejemplo: ${mErr.message}`)

  return items.map((i) => ({ id: i.id, precioCents: i.price_cents }))
}

/** Un día concreto de este mes, a una hora de jornada. Determinista: nada de aleatorio. */
export function diaDelMes(hoy: Date, diasAtras: number, hora: number): Date {
  const d = new Date(hoy.getTime() - diasAtras * 864e5)
  d.setUTCHours(hora + 5, 0, 0, 0) // +5 = hora de Bogotá expresada en UTC
  return d
}

export type ResultadoFacturas = { emitidas: number; conSaldo: number; vencidas: number }

/**
 * Emite facturas repartidas por el mes, con tres desenlaces distintos.
 *
 * LOS TRES DESENLACES SON EL PUNTO. Una demostración con todas las facturas pagadas deja Cartera
 * vacía y el aging en cero, que es media plataforma sin mostrar. Se siembra: pagadas (la mayoría),
 * con saldo a crédito, y **vencidas** —con `dueDate` en el pasado— que son las que llenan los
 * tramos de antigüedad y la lista de «requieren atención».
 */
export async function sembrarFacturas(
  admin: SupabaseClient,
  clinicId: string,
  userId: string,
  ownerIds: string[],
  items: ItemSembrado[],
  hoy: Date,
): Promise<ResultadoFacturas> {
  if (ownerIds.length === 0 || items.length === 0) {
    return { emitidas: 0, conSaldo: 0, vencidas: 0 }
  }

  // Repartidas de a pocos días para que el libro y la dona tengan varias fechas, no un solo bulto.
  const receta = [
    { diasAtras: 26, desenlace: "VENCIDA" as const },
    { diasAtras: 24, desenlace: "PAGADA" as const },
    { diasAtras: 21, desenlace: "VENCIDA" as const },
    { diasAtras: 19, desenlace: "PAGADA" as const },
    { diasAtras: 17, desenlace: "PAGADA" as const },
    { diasAtras: 15, desenlace: "SALDO" as const },
    { diasAtras: 13, desenlace: "PAGADA" as const },
    { diasAtras: 11, desenlace: "PAGADA" as const },
    { diasAtras: 9, desenlace: "SALDO" as const },
    { diasAtras: 7, desenlace: "PAGADA" as const },
    { diasAtras: 5, desenlace: "PAGADA" as const },
    { diasAtras: 3, desenlace: "SALDO" as const },
    { diasAtras: 1, desenlace: "PAGADA" as const },
    { diasAtras: 0, desenlace: "PAGADA" as const },
    { diasAtras: 0, desenlace: "PAGADA" as const },
  ]

  let emitidas = 0
  let conSaldo = 0
  let vencidas = 0

  for (let n = 0; n < receta.length; n++) {
    const { diasAtras, desenlace } = receta[n]
    const cuando = diaDelMes(hoy, diasAtras, 9 + (n % 8))
    const ownerId = ownerIds[n % ownerIds.length]

    const pagador = await ensurePayerForOwner(admin, clinicId, ownerId, userId)

    // Dos o tres renglones por factura, rotando el catálogo: así la dona reparte entre los cuatro
    // tipos en vez de concentrar todo en uno.
    const cuantos = 2 + (n % 2)
    const lineas = Array.from({ length: cuantos }, (_, k) => ({
      catalogItemId: items[(n + k) % items.length].id,
      qty: 1 + ((n + k) % 3),
    }))

    const { invoice } = await createDraftInvoice(
      admin,
      clinicId,
      {
        payerId: pagador.id,
        lines: lineas,
        // `notes` ES LA MARCA. Es la única columna de texto libre de la factura, y sin ella el
        // borrado no tendría por dónde agarrarla: una factura no cuelga del titular demo.
        // Se escribe primero el marcador y después la explicación, porque el borrado busca por
        // prefijo — si la marca quedara al final, un `like` con comodín delante sería más lento y
        // atraparía facturas donde alguien mencionara el texto por casualidad.
        notes: `${MARCA_DEMO} — documento de demostración, se borra desde el tablero.`,
        createdBy: userId,
      },
      cuando,
    )

    // `dueDate` en el pasado es lo que hace que la factura cuente como VENCIDA en el aging.
    const vence =
      desenlace === "VENCIDA"
        ? diaDelMes(hoy, diasAtras - 15, 12)
        : diaDelMes(hoy, diasAtras - 30, 12)

    await issueInvoice(
      admin,
      clinicId,
      {
        invoiceId: invoice.id,
        outcome: desenlace === "PAGADA" ? "PAGADO_AHORA" : "PENDIENTE",
        ...(desenlace === "PAGADA" ? { method: "EFECTIVO" as const } : {}),
        ...(desenlace === "PAGADA" ? {} : { dueDate: vence.toISOString().slice(0, 10) }),
      },
      cuando,
    )

    emitidas++
    if (desenlace !== "PAGADA") conSaldo++
    if (desenlace === "VENCIDA") vencidas++
  }

  return { emitidas, conSaldo, vencidas }
}

/**
 * La meta del mes, sin la cual el anillo de cumplimiento no se pinta (devuelve `null` con meta nula).
 *
 * Se pone POR ENCIMA de lo vendido a propósito: un anillo al 100 % no enseña nada — lo que se
 * quiere ver es cuánto falta y si el ritmo alcanza.
 */
export async function sembrarMeta(
  admin: SupabaseClient,
  clinicId: string,
  vendidoCents: number,
): Promise<number> {
  const meta = Math.max(vendidoCents, 1_000_000) * 1.25
  const redondeada = Math.round(meta / 100_000) * 100_000
  const { error } = await admin
    .from("clinics")
    .update({ meta_ventas_mensual_cents: redondeada })
    .eq("id", clinicId)
  if (error) throw new Error(`meta de ventas: ${error.message}`)
  return redondeada
}

/**
 * Borra TODO lo que sembró el modo completo, por marca y en orden seguro de claves foráneas.
 *
 * No alcanza con borrar el titular y confiar en las cascadas —que es lo que hacía el borrado
 * viejo—: nada de esto cuelga de él. Y las facturas arrastran líneas, pagos, aplicaciones y
 * eventos, así que el orden importa: primero lo que apunta, después lo apuntado.
 */
export async function borrarDemoCompleto(
  admin: SupabaseClient,
  clinicId: string,
): Promise<Record<string, number>> {
  const borrados: Record<string, number> = {}

  const { data: facturas } = await admin
    .from("invoices")
    .select("id")
    .eq("clinic_id", clinicId)
    .like("notes", `${MARCA_DEMO}%`)
  const idsFactura = ((facturas as { id: string }[] | null) ?? []).map((f) => f.id)

  if (idsFactura.length > 0) {
    const { data: pagos } = await admin
      .from("payment_applications")
      .select("payment_id")
      .in("invoice_id", idsFactura)
    const idsPago = [
      ...new Set(((pagos as { payment_id: string }[] | null) ?? []).map((p) => p.payment_id)),
    ]

    for (const [tabla, columna] of [
      ["invoice_lines", "invoice_id"],
      ["payment_applications", "invoice_id"],
      ["invoice_events", "invoice_id"],
    ] as const) {
      const { count } = await admin
        .from(tabla)
        .delete({ count: "exact" })
        .in(columna, idsFactura)
      borrados[tabla] = count ?? 0
    }

    if (idsPago.length > 0) {
      const { count } = await admin
        .from("payments")
        .delete({ count: "exact" })
        .eq("clinic_id", clinicId)
        .in("id", idsPago)
      borrados["payments"] = count ?? 0
    }

    const { count } = await admin
      .from("invoices")
      .delete({ count: "exact" })
      .eq("clinic_id", clinicId)
      .in("id", idsFactura)
    borrados["invoices"] = count ?? 0
  }

  // Los movimientos van ANTES que los ítems: apuntan a ellos.
  const { count: mov } = await admin
    .from("inventory_movements")
    .delete({ count: "exact" })
    .eq("clinic_id", clinicId)
    .like("note", `${MARCA_DEMO}%`)
  borrados["inventory_movements"] = mov ?? 0

  const { count: items } = await admin
    .from("catalog_items")
    .delete({ count: "exact" })
    .eq("clinic_id", clinicId)
    .like("sku", `${SKU_DEMO}%`)
  borrados["catalog_items"] = items ?? 0

  // La meta vuelve a nulo, que NO es lo mismo que cero: nulo significa «sin meta puesta» y hace
  // que el anillo no se pinte, que es como estaba antes de sembrar.
  await admin.from("clinics").update({ meta_ventas_mensual_cents: null }).eq("id", clinicId)

  return borrados
}

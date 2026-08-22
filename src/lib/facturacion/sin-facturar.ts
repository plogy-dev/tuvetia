// Qué es "una consulta sin facturar". UNA definición, y por eso vive acá.
//
// EL PROBLEMA QUE RESUELVE. La misma pregunta se responde en dos lugares —el riel de pendientes
// (`senales/consultar`) y la lista de Ventas (`getUnbilledConsultations`)— y el riel MANDA a la
// lista: dice "tenés 12 consultas sin facturar" y el vet hace clic esperando ver doce. Cualquier
// diferencia entre las dos reglas se ve como que la app miente.
//
// Ya pasó una vez: la lista descartaba las facturas ANULADAS y el riel no, así que una consulta
// cuya única factura se anuló quedaba escondida justo cuando había que volver a emitirla. Se
// arregló en los dos lados por separado, que es exactamente la forma en que vuelve a romperse.
//
// ── LAS TRES PIEZAS DE LA DEFINICIÓN ────────────────────────────────────────────────────────────
//
//   1. LA VENTANA: 60 días. Sin ella, una clínica que empieza a facturar hoy arrastraría al riel
//      un año de consultas viejas el primer día.
//   2. QUÉ CUENTA COMO FACTURADA: cualquier factura que siga en pie. Una ANULADA no cuenta —
//      anularla deja la consulta otra vez por cobrar.
//   3. EL TOPE: cuántas se miran como máximo. Tiene que ser el MISMO número en los dos lados, o el
//      riel y la lista dejan de coincidir en cuanto una clínica tenga volumen.
//
// Puro: `vitest.config.mts` corre en `environment: "node"`.

/** Días hacia atrás que se miran. */
export const DIAS_SIN_FACTURAR = 60

/**
 * Cuántas consultas se traen como máximo.
 *
 * ES EL MISMO EN EL RIEL Y EN LA LISTA, a propósito. Antes el riel miraba 200 y la lista 25, y
 * peor: la lista aplicaba su tope ANTES de descartar las facturadas, así que si las 25 más
 * recientes estaban todas facturadas devolvía cero — con quince sin facturar un mes atrás.
 *
 * Cuando el total llega al tope, lo honesto es decir "200+" y no "200": ver `hayMasQueElTope`.
 */
export const TOPE_SIN_FACTURAR = 200

/** El `select` de PostgREST que trae lo necesario para decidir. Uno solo, para que no se separen. */
export const EMBED_DE_FACTURAS = "invoices!left(id, status)"

/** Una factura, con lo mínimo para saber si sigue en pie. */
export type FacturaDeLaConsulta = { status: string }

/** El estado que anula una factura. Sale del enum de `invoices.status`. */
const ANULADA = "ANULADA"

/**
 * El instante desde el que se mira, en ISO.
 *
 * SE CUENTA DESDE EL DÍA DE BOGOTÁ y no desde "ahora": el corte tiene que ser el mismo durante toda
 * la jornada. Con `now() - 60 días` la lista cambiaría entre dos recargas hechas con diez minutos
 * de diferencia, y una consulta del borde entraría y saldría sola.
 */
export function desdeCuando(hoyISO: string): string {
  const d = new Date(`${hoyISO}T00:00:00-05:00`)
  d.setUTCDate(d.getUTCDate() - DIAS_SIN_FACTURAR)
  return d.toISOString()
}

/**
 * ¿Esta consulta sigue sin facturar?
 *
 * Sin ninguna factura, o con todas anuladas. El embed llega `null` cuando PostgREST no encontró
 * ninguna fila relacionada, así que ese caso es "sin facturar" y no un error.
 */
export function estaSinFacturar(facturas: FacturaDeLaConsulta[] | null | undefined): boolean {
  return !(facturas ?? []).some((f) => f.status !== ANULADA)
}

/** Las que siguen sin facturar, de un lote ya traído. */
export function soloSinFacturar<T extends { invoices?: FacturaDeLaConsulta[] | null }>(
  filas: T[],
): T[] {
  return filas.filter((f) => estaSinFacturar(f.invoices))
}

/**
 * ¿El total que se está mostrando es en realidad "o más"?
 *
 * Cuando se llega al tope no se sabe cuántas hay: se sabe que hay al menos ésas. Decir "200" a
 * secas sería inventar una precisión que la consulta no tiene — y es el mismo truncamiento
 * silencioso que ya se corrigió en `getDashboardKpis` y en `getStockMap`.
 */
export function hayMasQueElTope(total: number): boolean {
  return total >= TOPE_SIN_FACTURAR
}

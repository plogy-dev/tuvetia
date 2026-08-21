// El inventario, bajado a Excel.
//
// LO QUE FALTABA. Se podía SUBIR inventario desde Excel desde el principio, pero no bajarlo: lo
// único que exportaba la app era `/api/export`, un JSON crudo para respaldo de portabilidad. Para
// una clínica que quiere revisar precios con su contador, mandarle la lista a un proveedor o
// corregir cincuenta productos de una, "exportá el JSON" no es una respuesta.
//
// ── LA DECISIÓN QUE ORDENA TODO: ESTO TIENE QUE PODER VOLVER A ENTRAR ───────────────────────────
//
// Los encabezados NO son los que quedarían más lindos: son **exactamente los que `proposeMapping`
// reconoce**. Bajar el inventario, corregirlo en Excel y volver a subirlo es el motivo por el que
// alguien pide esto, y si los encabezados no calzan, el archivo que la app acaba de generar es un
// archivo que la app no sabe leer. Hay un test que lo verifica de punta a punta —exportar, parsear,
// mapear— justamente porque es la clase de contrato que se rompe sin que nadie se entere.
//
// ── LOS PRECIOS VAN EN PESOS ────────────────────────────────────────────────────────────────────
//
// La base guarda centavos. Un producto de $85.000 son 8.500.000 centavos, y esa cifra en una
// planilla no se lee como un error: se lee como ocho millones y medio. Se divide acá, una sola vez.
//
// ── Y LOS NÚMEROS VAN COMO NÚMEROS ──────────────────────────────────────────────────────────────
//
// No como texto. Es la diferencia entre una planilla que se puede sumar, ordenar y filtrar y una
// que hay que convertir a mano antes de servir para algo. `toNumber` del importador acepta las dos
// formas, así que no cuesta nada del lado de la vuelta.
//
// Puro salvo `libroDeInventario`: `vitest.config.mts` corre en `environment: "node"`.

import * as XLSX from "xlsx"

/** Lo que hace falta saber de un ítem para exportarlo. Estructural: no ata a la fila de Supabase. */
export type ItemExportable = {
  id: string
  name: string
  item_type: string
  sku: string | null
  category_id: string | null
  purchase_unit: string
  use_unit: string
  conversion_factor: number | string
  price_cents: number
  cost_cents: number | null
  tax_rate: number
  min_stock: number | string | null
  supplier: string | null
  location: string | null
  duration_minutes: number | null
  track_stock: boolean
}

export type ContextoDeExport = {
  /** Existencias derivadas de los movimientos, por id de ítem. */
  stock?: Map<string, number>
  /** Id de categoría → nombre. Lo que se exporta es el NOMBRE: un uuid no le sirve a nadie. */
  categorias?: Map<string, string>
}

const pesos = (centavos: number | null | undefined): number | "" =>
  centavos === null || centavos === undefined ? "" : centavos / 100

/**
 * Las columnas, en orden, con el encabezado que el importador reconoce.
 *
 * EL ORDEN ES EL DE LECTURA HUMANA —qué es, cuánto vale, cuánto hay, dónde está— y no el de la
 * tabla. Quien abre esto lo primero que busca es el nombre y el precio.
 */
const COLUMNAS: { encabezado: string; valor: (i: ItemExportable, c: ContextoDeExport) => unknown }[] = [
  { encabezado: "Nombre", valor: (i) => i.name },
  { encabezado: "Tipo", valor: (i) => i.item_type },
  { encabezado: "Categoría", valor: (i, c) => (i.category_id && c.categorias?.get(i.category_id)) || "" },
  { encabezado: "SKU", valor: (i) => i.sku ?? "" },
  { encabezado: "Precio de venta", valor: (i) => pesos(i.price_cents) },
  { encabezado: "Costo", valor: (i) => pesos(i.cost_cents) },
  { encabezado: "IVA", valor: (i) => i.tax_rate },
  // SERVICIOS SIN EXISTENCIA, y vacío en vez de 0: un servicio no está agotado, es que no se
  // cuenta. Un cero acá haría que la planilla mostrara quince servicios "sin stock".
  { encabezado: "Existencia", valor: (i, c) => (i.track_stock ? (c.stock?.get(i.id) ?? 0) : "") },
  { encabezado: "Stock mínimo", valor: (i) => (i.min_stock === null ? "" : Number(i.min_stock)) },
  { encabezado: "Unidad de compra", valor: (i) => i.purchase_unit },
  { encabezado: "Unidad de uso", valor: (i) => i.use_unit },
  { encabezado: "Factor de conversión", valor: (i) => Number(i.conversion_factor) },
  { encabezado: "Duración (minutos)", valor: (i) => i.duration_minutes ?? "" },
  { encabezado: "Proveedor", valor: (i) => i.supplier ?? "" },
  { encabezado: "Ubicación", valor: (i) => i.location ?? "" },
]

export const ENCABEZADOS = COLUMNAS.map((c) => c.encabezado)

/** La planilla como matriz: la fila 0 son los encabezados. */
export function filasDeInventario(
  items: ItemExportable[],
  contexto: ContextoDeExport = {},
): unknown[][] {
  return [ENCABEZADOS, ...items.map((i) => COLUMNAS.map((c) => c.valor(i, contexto)))]
}

/**
 * El .xlsx listo para descargar.
 *
 * UNA SOLA HOJA Y SIN FILA DE TÍTULO. La tentación de encabezar con "INVENTARIO — Clínica X" es
 * exactamente lo que rompía la importación de las planillas de los clientes: el importador ahora
 * sabe saltar títulos, pero generar el problema que uno acaba de arreglar sería raro. El nombre de
 * la clínica va en el nombre del archivo, que es donde no estorba.
 */
export function libroDeInventario(items: ItemExportable[], contexto: ContextoDeExport = {}): Buffer {
  const hoja = XLSX.utils.aoa_to_sheet(filasDeInventario(items, contexto))
  // Anchos para que no haya que arrastrar cada columna al abrir el archivo.
  hoja["!cols"] = ENCABEZADOS.map((h) => ({ wch: Math.max(12, h.length + 2) }))
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, "Inventario")
  return XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer
}

/** `Inventario-Clinica-Del-Sur-2026-08-21.xlsx`. Con fecha, porque se van a acumular en Descargas. */
export function nombreDelArchivo(clinica: string | null | undefined, hoyISO: string): string {
  const limpio = (clinica ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Lo que Windows no acepta en un nombre de archivo, más los espacios.
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `Inventario${limpio ? `-${limpio}` : ""}-${hoyISO}.xlsx`
}

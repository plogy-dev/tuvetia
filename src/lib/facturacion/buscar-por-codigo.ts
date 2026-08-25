// Encontrar un producto por lo que escupió el lector de código de barras.
//
// ── CÓMO FUNCIONA UN LECTOR, Y POR QUÉ IMPORTA ACÁ ────────────────────────────────────────────
//
// Un lector USB es un TECLADO: teclea el código muy rápido y manda Enter. No hay API, no hay
// permisos, no hay driver. Por eso esto no necesita nada del navegador — necesita un campo enfocado
// y saber qué hacer con lo que llega.
//
// Y por eso mismo llega texto sucio: espacios al final, un salto de línea, a veces el código con
// ceros a la izquierda que la planilla del proveedor no tenía.
//
// ── LA TRAMPA QUE ESTA FUNCIÓN EXISTE PARA EVITAR ─────────────────────────────────────────────
//
// La forma ingenua de buscar es `items.find(i => i.barcode === codigo)`. Con un código vacío —un
// Enter suelto, que en un mostrador pasa— y un catálogo donde casi ningún ítem tiene código,
// `(i.barcode ?? "") === ""` da VERDADERO para el primer ítem sin código de la lista. O sea: un
// Enter de más agrega un producto al azar a la cuenta de un cliente.
//
// Por eso se descarta el vacío ANTES de comparar, y por eso los ítems sin código nunca compiten.
//
// ── DOS PRODUCTOS CON EL MISMO CÓDIGO ─────────────────────────────────────────────────────────
//
// Pasa: se duplica un ítem al importar, o se copia uno para cambiarle la presentación y se olvida
// el código. Elegir el primero en silencio factura el producto equivocado y nadie se entera hasta
// que el inventario no cuadra. Se devuelve `ambiguo` y la pantalla lo dice — es un error de datos
// que la clínica puede arreglar, pero sólo si se lo cuentan.

export type ResultadoDeBusqueda<T> =
  | { tipo: "encontrado"; item: T }
  | { tipo: "ambiguo"; items: T[] }
  | { tipo: "sin-resultado" }
  | { tipo: "vacio" }

type ConCodigos = { barcode?: string | null; sku?: string | null }

/** Normaliza para comparar: sin espacios alrededor y sin distinguir mayúsculas. */
function clave(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase()
}

/**
 * Busca el ítem cuyo código de barras —o, si no, cuyo SKU— coincide EXACTAMENTE con lo escaneado.
 *
 * El código de barras manda sobre el SKU: es lo que el lector lee de la caja. El SKU es respaldo
 * porque muchas clínicas cargan ahí la referencia del proveedor y nunca llenan `barcode`, y para
 * ellas el lector serviría igual.
 *
 * SIEMPRE EXACTO, nunca parcial. Un `includes` haría que el código «123» trajera el producto
 * «1234»: en una búsqueda escrita eso ayuda, en una venta factura otra cosa.
 */
export function buscarPorCodigo<T extends ConCodigos>(
  items: T[],
  codigo: string,
): ResultadoDeBusqueda<T> {
  const buscado = clave(codigo)
  if (!buscado) return { tipo: "vacio" }

  // Por código de barras primero. Los ítems sin código no compiten: `clave(null)` es "" y ya se
  // descartó el buscado vacío, así que nunca puede empatar.
  const porBarras = items.filter((i) => clave(i.barcode) === buscado)
  if (porBarras.length === 1) return { tipo: "encontrado", item: porBarras[0] }
  if (porBarras.length > 1) return { tipo: "ambiguo", items: porBarras }

  const porSku = items.filter((i) => clave(i.sku) === buscado)
  if (porSku.length === 1) return { tipo: "encontrado", item: porSku[0] }
  if (porSku.length > 1) return { tipo: "ambiguo", items: porSku }

  return { tipo: "sin-resultado" }
}

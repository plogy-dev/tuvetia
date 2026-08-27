// Paginación de lecturas grandes, sin cliente ni red: recibe una función que trae UN rango y la
// llama hasta que la fuente se queda sin filas. Vive aparte de `metrics.ts` para poder probarla —
// `metrics.ts` construye el cliente `service_role` y sale a internet, y esta lógica es justo la
// parte que se rompió y la que hay que fijar con un test.

/**
 * El `max-rows` de PostgREST. Pedir más de mil filas en una sola respuesta devuelve mil: sin error,
 * sin cabecera que chille, sin nada que mirar. Está medido en `src/lib/facturacion/queries.ts`, que
 * ya tropezó tres veces con lo mismo (`getDashboardKpis`, `getStockMap`, `listCatalogItems`).
 */
export const PASO = 1000

/**
 * Tope de seguridad, en filas. No está para recortar nada de lo que hay hoy —`whatsapp_messages`,
 * la tabla más grande que agrega /admin, va por 10.158 filas— sino para que una fuente que devuelva
 * páginas llenas para siempre (un `range` que el servidor ignore, un bug de nuestro lado) no deje
 * la petición del panel girando hasta el timeout.
 *
 * El número coincide a propósito con la nota de escala de `metrics.ts`: pasadas las 100k filas de
 * logs, estas agregaciones tienen que mudarse a RPCs de SQL. Alcanzar el tope no es "hay que subir
 * el tope", es "se acabó el plazo de agregar en JS".
 */
export const TOPE = 100_000

/** Trae UNA página. `desde`/`hasta` son inclusivos, como el `.range()` de supabase-js. */
export type TraerPagina<T> = (desde: number, hasta: number) => Promise<T[]>

export type Paginado<T> = {
  filas: T[]
  /**
   * `true` cuando se cortó por el tope **con la última página llena**, o sea sin ninguna evidencia
   * de haber llegado al final. No afirma que falten filas —justo en un múltiplo exacto del paso
   * puede no faltar ninguna—, afirma algo más útil y más honesto: que no se sabe, y que la única
   * forma de saberlo era pedir otra página, que es lo que el tope prohíbe.
   */
  truncado: boolean
  /** Vueltas dadas. Sirve para el aviso y para exigir en los tests que el bucle termine. */
  paginas: number
}

/**
 * Junta todas las páginas de `traer`.
 *
 * LA GUARDA, Y POR QUÉ ÉSTA SÍ PUEDE DISPARAR. La versión anterior de `metrics.ts` pedía
 * `.limit(10000)` y avisaba con `if (rows.length === CAP)`. Esa comparación no podía ser cierta
 * nunca: PostgREST corta en mil, así que `rows.length` valía 1000 y `1000 === 10000` es falso. El
 * aviso jamás salió mientras el panel reportaba mil mensajes de WhatsApp donde había diez mil.
 *
 * El error de fondo —el que alguien vuelve a escribir— es comparar contra lo que uno PIDIÓ. Lo que
 * uno pide no lo decide uno: lo decide la capa de abajo. La única referencia que sirve es la cifra
 * que esa capa PUEDE devolver, y ésa es el tamaño de página: una página llena es observable, un
 * `limit` gigante no.
 */
export async function paginar<T>(
  traer: TraerPagina<T>,
  opts: { paso?: number; tope?: number } = {},
): Promise<Paginado<T>> {
  // Un paso de 0 o negativo pediría rangos vacíos para siempre; el piso en 1 es lo que garantiza
  // que cada vuelta avance aunque el que llama se equivoque al configurar.
  const paso = Math.max(1, Math.trunc(opts.paso ?? PASO))
  const tope = opts.tope ?? TOPE

  const filas: T[] = []
  let desde = 0
  let paginas = 0

  for (;;) {
    const pagina = await traer(desde, desde + paso - 1)
    paginas++
    filas.push(...pagina)

    // Página incompleta = la fuente ya no tiene más. Es la única señal de "terminé" que PostgREST
    // da, y es la razón de que una tabla de exactamente 1.000 filas cueste una consulta de más.
    if (pagina.length < paso) return { filas, truncado: false, paginas }
    if (filas.length >= tope) return { filas, truncado: true, paginas }

    // Avanzar por lo que REALMENTE vino, no por lo que se pidió: si una fuente devolviera de más,
    // sumar `paso` volvería a leer filas ya contadas. Y como acá `pagina.length >= paso >= 1`, el
    // cursor siempre crece — es lo que hace imposible el bucle infinito por falta de avance.
    desde += Math.max(pagina.length, paso)
  }
}

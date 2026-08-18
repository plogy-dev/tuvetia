// Los filtros que viven en la URL, sin recargar la página.
//
// EL BUG, Y ES EL MISMO QUE EL DEL MENÚ CON OTRA CARA. Un `<form method="get">` que se envía solo
// hace una navegación NATIVA del navegador: descarga el documento de nuevo. Con una grabación en
// curso eso dispara el `beforeunload` de la sesión —el diálogo de «¿salir del sitio?»— y mata la
// consulta, exactamente igual que las anclas crudas que se arreglaron en el menú lateral.
//
// Y estaba en el peor sitio posible: el buscador de `/dashboard/consultas`, que ES la pantalla del
// Modo Fantasma. Grabar, buscar una consulta anterior para comparar, y perder la grabación.
//
// Es lo que explica que el fallo se viera "inconsistente": arreglado el menú, quedaba este otro
// camino, que además es el que uno usa justo mientras atiende.
//
// POR QUÉ NO SE BORRA EL `action` DEL FORMULARIO. Sin JavaScript, el envío nativo sigue siendo la
// única forma de que el filtro funcione. Se conserva y se INTERCEPTA: con JS navega el cliente, sin
// JS el navegador hace lo de siempre. Es mejora progresiva, no un reemplazo.

/** Lo que un `<form>` entrega. Se acepta cualquier iterable de pares para poder probarlo sin DOM. */
export type CamposDelFormulario = Iterable<[string, FormDataEntryValue]>

/**
 * Arma la query string de un formulario de filtros.
 *
 * LOS CAMPOS VACÍOS NO VIAJAN, y es la diferencia con el envío nativo: un `<form>` manda `q=` cuando
 * el campo está en blanco, y eso deja URLs con parámetros muertos que después hay que ignorar en
 * cada página. Borrar el buscador y enviar sigue limpiando el filtro —el parámetro simplemente no
 * está—, que es el mismo resultado con la mitad de ruido.
 *
 * Los archivos se descartan: un filtro es texto, y un `File` en la URL no significa nada.
 */
export function construirBusqueda(campos: CamposDelFormulario): string {
  const params = new URLSearchParams()
  for (const [clave, valor] of campos) {
    if (typeof valor !== "string") continue
    const limpio = valor.trim()
    if (limpio) params.set(clave, limpio)
  }
  return params.toString()
}

/**
 * La ruta a la que hay que navegar. Sin filtros devuelve la ruta pelada, sin el `?` colgando.
 */
export function rutaConBusqueda(ruta: string, campos: CamposDelFormulario): string {
  const qs = construirBusqueda(campos)
  return qs ? `${ruta}?${qs}` : ruta
}

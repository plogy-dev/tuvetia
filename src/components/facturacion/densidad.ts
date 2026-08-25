// La densidad de las tablas de ventas, definida en UN solo sitio.
//
// ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
//
// De comparar contra OkVet el 25-ago, midiendo sus estilos computados en vez de mirar capturas. Su
// módulo de ventas es notablemente más denso que el nuestro:
//
//   · cuerpo a 12 px (nosotros veníamos en 13-14)
//   · encabezados de tabla a 12 px, peso 500, SIN VERSALITAS ni tracking abierto
//   · relleno de celda de 12×9 px
//
// Un veterinario que trabaja con esto abre una lista de ventas para BARRERLA con la vista —cuántas
// facturas van, cuáles están sin cobrar— y en esa tarea la densidad manda: cuantas más filas
// entran de un vistazo, menos hay que desplazarse.
//
// ── LO QUE SE ADOPTA Y LO QUE NO ──────────────────────────────────────────────────────────────
//
// Se adopta LA DENSIDAD. No se adopta su identidad: la tipografía sigue siendo la nuestra (Inter
// Tight), el acento sigue siendo menta y el fondo sigue siendo blanco. Copiar Poppins y su azul
// sería copiar su marca, no su usabilidad — y atropellaría el mockup que Luciano trabajó y que el
// cliente ya aprobó en varias decisiones (el orden de la barra, los puntos en vez de iconos, el
// botón menta relleno).
//
// ── POR QUÉ SE VAN LAS VERSALITAS ─────────────────────────────────────────────────────────────
//
// `uppercase` + `tracking` abierto en los encabezados era nuestro. Se ve ordenado y se lee PEOR de
// reojo: las mayúsculas quitan la silueta que distingue una palabra de otra, que es justo lo que
// usa el ojo cuando barre una tabla sin leerla. OkVet los deja en caja normal, y para quien viene
// de ahí además son los que espera encontrar.
//
// ── POR QUÉ UN MÓDULO Y NO CLASES SUELTAS ─────────────────────────────────────────────────────
//
// Antes esto vivía copiado en cinco archivos —la lista de ventas, cartera, finanzas, inventario y
// el catálogo— con valores parecidos pero distintos: 11 px acá, `tracking-wider` allá,
// `tracking-[0.06em]` más allá. Así es como una tabla termina viéndose de otro módulo. Acá se
// decide una vez.

/** Encabezado de tabla. Caja normal, peso medio: se barre mejor que en versalitas. */
export const TH =
  "border-b border-line-soft px-3 py-2 text-left text-[11.5px] font-medium text-fg-faint"

/** Encabezado alineado a la derecha (importes). */
export const TH_DER = `${TH} text-right`

/** Celda de tabla. */
export const TD = "px-3 py-2 align-middle text-[12.5px]"

/** Celda de importes: alineada a la derecha y con cifras de ancho fijo. */
export const TD_NUM = `${TD} text-right font-mono tabular-nums`

/** Alto de los controles de filtro. Un escalón por debajo del `h-9` del resto de la app. */
export const CONTROL = "h-8"

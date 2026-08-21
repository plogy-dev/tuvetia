// En qué fila empieza la tabla de verdad.
//
// EL DEFECTO, y es el peor de los tres que salieron en el barrido del 21-ago. Los dos importadores
// —inventario y pacientes— toman la **fila 0** como encabezado, siempre. Una planilla real casi
// nunca empieza ahí: trae una fila de título ("INVENTARIO CLÍNICA VETERINARIA"), a veces la fecha
// del reporte, a veces una fila en blanco.
//
// Y CUANDO PASA, NO FALLA A MEDIAS: FALLA ENTERO. Medido con un xlsx con una fila de título encima:
//
//     columnas = ["INVENTARIO CLINICA", "", "_1", "_2", "_3"]   →  0 de 5 mapeadas
//     fila 0   = { "INVENTARIO CLINICA": "Nombre", "": "Categoría", ... }
//
// O sea: los encabezados reales entran como si fueran DATOS, y las columnas se llaman `_1`, `_2`.
// Eso es exactamente *"a veces las columnas de Excel las está intercambiando y las está mezclando"*
// y *"subo dos bien, el tercero baila"* — el tercero es el que traía título.
//
// ── CÓMO SE ELIGE ───────────────────────────────────────────────────────────────────────────────
//
// Dos señales, en orden:
//
//   1. **RECONOCER.** Si quien llama sabe qué encabezados espera —el importador de inventario lo
//      sabe: "nombre", "precio", "existencia"…— gana la fila que reconoce MÁS. Es la señal fuerte:
//      no depende de la forma de la planilla sino de su contenido.
//   2. **DENSIDAD.** Sin nada reconocible, la primera fila con al menos dos celdas con texto. Una
//      fila de título suele tener una sola celda ocupada, que es justo lo que la descarta.
//
// ANTE LA DUDA, LA FILA 0 — que es lo que se hacía antes. Este módulo sólo puede mejorar el caso
// que hoy falla; nunca empeorar el que hoy anda.
//
// SÓLO SE MIRAN LAS PRIMERAS FILAS. Una tabla cuyo encabezado está en la fila 30 no es una tabla
// con título arriba, es otra cosa — y recorrer el archivo entero buscando encabezados encontraría
// falsos positivos en los datos.
//
// Puro: `vitest.config.mts` corre en `environment: "node"`.

const CUANTAS_MIRAR = 10

const conTexto = (fila: string[]) => fila.filter((c) => c.trim() !== "").length

/**
 * El índice de la fila que es el encabezado.
 *
 * @param filas   La planilla como matriz de texto, desde la primera fila del archivo.
 * @param reconoce  ¿Esta celda parece un encabezado que sabemos mapear? Opcional: sin esto se
 *                  decide sólo por densidad.
 */
export function filaDeCabecera(filas: string[][], reconoce?: (celda: string) => boolean): number {
  if (filas.length === 0) return 0
  const hasta = Math.min(filas.length, CUANTAS_MIRAR)

  // 1. La que más encabezados conocidos tiene. Empate → la primera, porque el título de arriba no
  //    puede reconocer más que la tabla y una fila de datos que empate con el encabezado es una
  //    coincidencia, no una tabla nueva.
  if (reconoce) {
    let mejor = -1
    let cuantos = 0
    for (let i = 0; i < hasta; i++) {
      const n = filas[i].filter((c) => c.trim() !== "" && reconoce(c)).length
      if (n > cuantos) {
        cuantos = n
        mejor = i
      }
    }
    if (mejor >= 0) return mejor
  }

  // 2. Sin nada reconocible: la primera fila que no sea un título suelto ni esté vacía.
  for (let i = 0; i < hasta; i++) {
    if (conTexto(filas[i]) >= 2) return i
  }

  return 0
}

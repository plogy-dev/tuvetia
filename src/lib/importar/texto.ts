// Los bytes de un CSV, como texto — adivinando la codificación.
//
// EL DEFECTO. `buffer.toString("utf-8")` asume que todo CSV es UTF-8, y en Colombia casi ninguno lo
// es: **Excel en Windows guarda "CSV" en Windows-1252 por defecto**. Los bytes de una `í` (0xED) no
// son UTF-8 válido, así que `toString` los reemplaza por `�` y "Categoría" llega como "Categor�a".
//
// Y ESO NO SE VE COMO UN ERROR DE ACENTOS, SE VE COMO COLUMNAS QUE NO CALZAN. El encabezado
// corrompido no matchea ninguna regla de `proposeMapping`, así que esa columna queda sin mapear y
// sus datos no entran. Medido en el barrido del 21-ago: un CSV latin-1 mapea **4 de 5** columnas —
// falla justo la que lleva tilde. Es una de las tres causas de lo que David reportó como "subo dos
// bien, el tercero baila".
//
// ── CÓMO SE DECIDE ──────────────────────────────────────────────────────────────────────────────
//
// No se adivina por heurística de frecuencias: se PRUEBA. `TextDecoder("utf-8", {fatal:true})`
// lanza ante cualquier secuencia inválida, así que si no lanza, el archivo ES UTF-8 y se usa tal
// cual. Sólo cuando lanza se cae a Windows-1252, que es lo que produce Excel.
//
// El orden importa y no es simétrico: UTF-8 es un código verificable —hay secuencias de bytes
// prohibidas—, mientras que en Windows-1252 **cualquier byte es válido**. Probar 1252 primero
// aceptaría siempre y nunca llegaríamos a UTF-8. Por eso se prueba el estricto y 1252 es el
// respaldo, no al revés.
//
// Puro: `vitest.config.mts` corre en `environment: "node"`.

/** El BOM de UTF-8. Papa lo tolera, pero dejarlo pegado al primer encabezado es pedir problemas. */
const BOM = "﻿"

export function comoTexto(buffer: Buffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

  let texto: string
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    // No es UTF-8 válido: lo más probable con diferencia es Excel de Windows.
    texto = new TextDecoder("windows-1252").decode(bytes)
  }

  return texto.startsWith(BOM) ? texto.slice(BOM.length) : texto
}

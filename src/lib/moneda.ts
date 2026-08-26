// Escribir plata en Tuvetia: siempre pesos colombianos, siempre con separador de miles.
//
// ── EL PROBLEMA ────────────────────────────────────────────────────────────────────────────────
//
// Los campos de dinero eran `<input type="number">` pelados. En el onboarding, cargando el precio de
// una consulta, lo que se veía era una caja vacía que aceptaba un número — y nada decía si ese
// número eran pesos, miles de pesos o centavos. Un `50000` sin formato tampoco se lee: hay que
// contar los ceros con el dedo para saber si son cincuenta mil o quinientos mil.
//
// ── LA DECISIÓN ────────────────────────────────────────────────────────────────────────────────
//
// El valor SIGUE SIENDO EN PESOS. No cambia lo que se guarda ni hay que migrar nada: lo único que
// cambia es que el campo se lee. Se agrupa de a tres con punto —que es el separador de miles de
// Colombia— mientras se teclea, y el rótulo `COP` va pegado al campo.
//
// Se descartó que el campo fuera "en miles" (escribir 50 para $50.000). Ahorra tres teclas y cambia
// qué significa el número: habría que migrar todo lo cargado, y cualquiera que escribiera 50000
// pensando en pesos cargaría cincuenta millones sin que nada se lo advirtiera.
//
// ── POR QUÉ NO ALCANZA `Intl.NumberFormat` ─────────────────────────────────────────────────────
//
// Porque esto formatea MIENTRAS SE ESCRIBE, y ahí el texto pasa por estados que no son números:
// vacío, un solo dígito, o lo que quede después de borrar en el medio. `Intl` sobre eso devuelve
// "NaN", y el campo escupe NaN en la cara de alguien que sólo apretó backspace. Acá se trabaja
// sobre los DÍGITOS, que es lo único que siempre existe.

/** Sólo los dígitos, en orden. Es lo único que sobrevive a cualquier estado intermedio del campo. */
function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "")
}

/**
 * El texto tal como debe verse en el campo mientras se escribe.
 *
 * Vacío se queda vacío: convertirlo en "0" es la peor forma de ayudar — el vet borra para escribir
 * otro precio y el campo le pone un cero que después queda guardado si se distrae.
 *
 * Los ceros a la izquierda se van (`007` → `7`), pero un `0` solo se respeta: es un valor legítimo
 * para un servicio sin cargo, y borrárselo mientras escribe sería pelearle al teclado.
 */
export function formatearMientrasEscribe(texto: string): string {
  const digitos = soloDigitos(texto)
  if (!digitos) return ""
  const limpio = digitos.replace(/^0+(?=\d)/, "")
  return agruparMiles(limpio)
}

/** `1234567` → `1.234.567`. El punto es el separador de miles de Colombia. */
export function agruparMiles(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

/**
 * El número que hay que guardar, en PESOS.
 *
 * `null` cuando el campo está vacío, y esa distinción importa: en el onboarding un servicio sin
 * precio es un servicio que NO se crea, mientras que uno en `0` es un servicio sin cargo. Colapsar
 * los dos en `0` crearía media docena de servicios gratis que nadie pidió.
 */
export function pesosDesdeTexto(texto: string): number | null {
  const digitos = soloDigitos(texto)
  if (!digitos) return null
  const n = Number(digitos)
  return Number.isSafeInteger(n) ? n : null
}

/** Un número de pesos al texto del campo. Para sembrar el valor inicial de un formulario. */
export function textoDesdePesos(pesos: number | null | undefined): string {
  if (pesos === null || pesos === undefined || !Number.isFinite(pesos)) return ""
  return agruparMiles(String(Math.trunc(Math.abs(pesos))))
}

/**
 * Pesos listos para mostrar, con símbolo: `50000` → `$ 50.000`.
 *
 * Es el hermano de `formatCOP` de facturación, que trabaja en CENTAVOS porque todo el dinero
 * facturado se guarda así. Éste toma PESOS, que es lo que escribe una persona. Los dos existen a
 * propósito: mezclarlos es cómo aparece un precio cien veces más caro.
 */
export function pesosLegibles(pesos: number | null | undefined): string {
  if (pesos === null || pesos === undefined || !Number.isFinite(pesos)) return "—"
  const signo = pesos < 0 ? "-" : ""
  return `${signo}$ ${agruparMiles(String(Math.trunc(Math.abs(pesos))))}`
}

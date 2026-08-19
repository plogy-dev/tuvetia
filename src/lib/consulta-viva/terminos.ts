// Qué buscar, sacado de lo que se está diciendo en la consulta.
//
// PARA QUÉ. La pestaña "Casos parecidos" del prototipo: mientras el vet atiende, Athos muestra
// consultas ANTERIORES de la clínica que se parecen a ésta. No es literatura —eso es la pestaña de
// sugerencias— es la memoria del propio consultorio: "esto ya lo viste en marzo, con Nala".
//
// POR QUÉ NO LO RESUELVE UN MODELO. Podría, y costaría una llamada cada vez. Pero lo que hace falta
// acá no es entender: es encontrar las palabras raras. En una transcripción de veterinaria, las
// palabras que NO son comunes son casi siempre los signos y los diagnósticos —"vómito", "cojera",
// "Malassezia"— y con eso alcanza para un `ilike` sobre las notas de la clínica.
//
// O sea: cero tokens, cero latencia de proveedor, y nada que sumar al tope mensual. Si algún día no
// alcanza, se cambia por embeddings; el contrato de esta función no cambia.
//
// ES UNA HEURÍSTICA Y SE COMPORTA COMO TAL: si no encuentra nada, la pestaña dice que no encontró,
// no inventa parecidos.

/**
 * Palabras que aparecen en cualquier consulta y no distinguen ninguna.
 *
 * Están a mano y no salen de una librería a propósito: son las de UNA transcripción veterinaria en
 * español rioplatense/colombiano, no las de un corpus general. "Doctor", "perrito" y "señora"
 * aparecen en todas y no dicen nada del caso.
 */
const VACIAS = new Set([
  "que", "de", "la", "el", "en", "y", "a", "los", "las", "un", "una", "por", "con", "no", "se",
  "su", "es", "lo", "le", "del", "al", "me", "mi", "te", "si", "ya", "pero", "como", "mas", "más",
  "muy", "para", "esta", "este", "eso", "esa", "ese", "hay", "ha", "he", "son", "fue", "era",
  "tiene", "tengo", "vamos", "bueno", "listo", "bien", "acá", "aca", "ahí", "ahi", "aquí", "aqui",
  "entonces", "porque", "cuando", "donde", "dónde", "qué", "cómo", "sí", "señora", "señor", "doctor",
  "doctora", "gracias", "hola", "usted", "él", "ella", "nos", "les", "ver", "veo", "dice", "dijo",
  "creo", "puede", "hacer", "poco", "algo", "todo", "toda", "nada", "otra", "otro", "días", "dias",
  "día", "dia", "semana", "mes", "vez", "veces", "perro", "perrito", "gato", "gatito", "mascota",
  "animal", "paciente", "consulta", "ahora", "antes", "después", "despues", "mucho", "mucha",
])

/** Cuántas palabras se usan para buscar. Más que esto y el `ilike` no encuentra nada. */
export const MAX_TERMINOS = 4

/** Una palabra sirve si es lo bastante larga para no ser ruido. */
const MIN_LARGO = 5

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

/**
 * Los términos con los que buscar consultas parecidas, del más distintivo al menos.
 *
 * SE ORDENA POR FRECUENCIA porque en una transcripción lo que se repite es el motivo: si "vómito"
 * aparece nueve veces, de eso trata la consulta. Y se descartan las que aparecen UNA sola vez —
 * suelen ser errores de transcripción, y buscar por un error no encuentra nada.
 */
export function terminosDeBusqueda(transcripcion: string, limite = MAX_TERMINOS): string[] {
  const cuenta = new Map<string, number>()

  for (const palabra of normalizar(transcripcion).split(/[^\p{L}\p{N}]+/u)) {
    if (palabra.length < MIN_LARGO || VACIAS.has(palabra)) continue
    cuenta.set(palabra, (cuenta.get(palabra) ?? 0) + 1)
  }

  return [...cuenta.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limite)
    .map(([palabra]) => palabra)
}

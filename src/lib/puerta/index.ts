// La puerta de la plataforma, la mitad que no toca la base.
//
// SIN `server-only` A PROPÓSITO, por lo mismo que `lib/planes`: lo consumen las dos mitades. El
// formulario de registro normaliza el código que el vet teclea y el servidor normaliza el que
// compara contra la base — si cada uno tuviera su propia idea de qué es "el mismo código", el vet
// escribiría `vets2026`, la pantalla lo daría por bueno y el servidor no lo encontraría.
//
// La mitad que sí consulta la base vive en `servidor.ts`, y la migración que la sostiene es la
// `0100_la_puerta_de_la_plataforma.sql`.

/** Los dos estados. Espeja el CHECK de `platform_gate.modo`. */
export type ModoDeLaPuerta = "abierto" | "cerrado"

/**
 * La forma del código. Espeja `access_codes_forma` en la migración 0100 — es la misma expresión.
 *
 * Sin minúsculas y sin caracteres raros: el código viaja en un enlace que se comparte por WhatsApp,
 * se lee en voz alta por teléfono y se teclea a mano. Todo lo que no sobreviva a ese viaje sobra.
 */
export const FORMA_DEL_CODIGO = /^[A-Z0-9-]{4,32}$/

/**
 * El alfabeto para los códigos que genera el panel.
 *
 * NO ESTÁN NI `O` NI `0` NI `I` NI `1` NI `L`. Un código se dicta por teléfono y se transcribe de
 * una captura de pantalla; los pares que se confunden son la mitad de los "no me funciona el
 * código" y no cuestan nada de evitar.
 */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

/**
 * El mismo código, en la única forma en que se guarda y se compara.
 *
 * Quita todo lo que no sea del alfabeto en vez de rechazarlo: quien pega `VETS 2026` o
 * `vets_2026` desde un mensaje quiso escribir `VETS2026`, y hacerlo fallar por un espacio invisible
 * es la clase de fricción que hace abandonar un registro.
 */
export function normalizarCodigo(bruto: string | null | undefined): string {
  return (bruto ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 32)
}

/**
 * Un código ya validado, listo para atar a un correo.
 *
 * Vive acá y no en el componente que lo pinta porque lo usan los dos lados del registro —la puerta
 * que lo valida y el formulario que lo canjea— y tenerlo en uno de ellos los deja importándose en
 * círculo.
 */
export type PaseDeRegistro = { codigo: string; dias: number }

/** La fila de un código, con lo justo para decidir si sirve. */
export type CodigoDeAcceso = {
  codigo: string
  dias: number
  max_usos: number
  usos: number
  expira_en: string | null
  activo: boolean
}

export type VeredictoDelCodigo =
  | { sirve: true }
  | { sirve: false; motivo: "no-existe" | "desactivado" | "vencido" | "agotado" }

/**
 * Por qué NO sirve un código, en el idioma del vet.
 *
 * Los cuatro motivos dicen cosas distintas y la diferencia importa: "no existe" se arregla
 * revisando lo que se tecleó, "agotado" se arregla pidiéndole otro a quien lo repartió. Un
 * "código inválido" genérico para los cuatro obliga a adivinar cuál de las dos cosas hacer.
 */
export const MOTIVOS: Record<Exclude<VeredictoDelCodigo, { sirve: true }>["motivo"], string> = {
  "no-existe": "Ese código no existe. Revisá que esté completo y sin espacios.",
  desactivado: "Ese código ya no está activo. Pedile uno nuevo a quien te lo compartió.",
  vencido: "Ese código venció. Pedile uno nuevo a quien te lo compartió.",
  agotado: "Ese código ya se usó todas las veces disponibles. Pedile uno nuevo a quien te lo compartió.",
}

/**
 * ¿Este código admite a alguien más?
 *
 * `ahora` entra por parámetro y no se lee de `Date.now()` adentro: es lo que hace que el
 * vencimiento se pueda probar sin viajar en el tiempo.
 */
export function veredictoDelCodigo(
  fila: CodigoDeAcceso | null | undefined,
  ahora: Date,
): VeredictoDelCodigo {
  if (!fila) return { sirve: false, motivo: "no-existe" }
  if (!fila.activo) return { sirve: false, motivo: "desactivado" }
  if (fila.expira_en && new Date(fila.expira_en).getTime() <= ahora.getTime()) {
    return { sirve: false, motivo: "vencido" }
  }
  if (fila.usos >= fila.max_usos) return { sirve: false, motivo: "agotado" }
  return { sirve: true }
}

/**
 * Un código nuevo, legible.
 *
 * `rng` entra por parámetro para poder fijarlo en los tests. En producción es `Math.random` y no
 * hace falta más: un código no es un secreto criptográfico —se comparte por WhatsApp, se dicta por
 * teléfono— y lo que impide adivinarlo por fuerza bruta es `max_usos`, no la entropía.
 */
export function generarCodigo(prefijo = "VET", rng: () => number = Math.random): string {
  const cuerpo = Array.from(
    { length: 6 },
    () => ALFABETO[Math.floor(rng() * ALFABETO.length)],
  ).join("")
  return normalizarCodigo(`${prefijo}${cuerpo}`)
}

/**
 * El enlace que se comparte.
 *
 * ES `/signup?codigo=`, y no una ruta propia tipo `/probar/CODIGO`, porque el destino tiene que ser
 * la pantalla de registro: quien abre el enlace ya está donde tiene que estar, con el código puesto
 * y sin un salto intermedio que se pueda perder. Con la puerta abierta el mismo enlace sigue
 * sirviendo — canjea los días de prueba y ya.
 */
export function enlaceDelCodigo(origen: string, codigo: string): string {
  return `${origen.replace(/\/+$/, "")}/signup?codigo=${encodeURIComponent(normalizarCodigo(codigo))}`
}

// Las alergias del paciente cruzadas contra el texto de un plan clínico.
//
// POR QUÉ EXISTE. La nota de la consulta tiene un gate de alergia severa que BLOQUEA la aprobación,
// y está bien — pero vive en un panel arriba de la pantalla, dice "hay una alergia severa
// registrada" y **no nombra el fármaco**. El vet lee "revisá el plan" sin que nadie le diga contra
// qué revisarlo, y el plan puede estar tres pantallazos más abajo.
//
// El mockup del cliente lo resuelve en el lugar correcto: la contraindicación va EN ROJO, EN LÍNEA,
// dentro del texto del plan. Ahí es donde se toma la decisión de prescribir.
//
// La diferencia con el mockup: en el mockup esa frase la escribió el modelo. Acá no dependemos de
// eso. `allergies` es una tabla, la comparación es de texto y el resultado es el mismo cada vez —
// un chequeo de seguridad clínica no puede depender de que la redacción haya salido bien ese día.
//
// SESGO DELIBERADO HACIA LA ALARMA. Ante la duda marca de más: el falso positivo cuesta que el vet
// lea una palabra resaltada que ya tenía clara; el falso negativo cuesta una prescripción contra
// una alergia registrada. Por eso el plural entra en la coincidencia y las tildes no importan.

export type AlergiaRegistrada = {
  allergen: string
  severity: string
  reaction?: string | null
}

/** Un trozo del plan. `alergeno` no nulo = ese texto menciona algo a lo que el paciente es alérgico. */
export type TrozoDePlan = { texto: string; alergeno: AlergiaRegistrada | null }

/** Único mapa de severidades del repo. Lo consumen la ficha, la tarjeta de Athos y la nota. */
export const SEVERIDAD_ALERGIA: Record<string, string> = {
  mild: "leve",
  moderate: "moderada",
  severe: "severa",
}

export function esSevera(a: AlergiaRegistrada): boolean {
  return a.severity === "severe"
}

/**
 * Minúsculas y sin tildes, **conservando la longitud carácter por carácter**.
 *
 * No usa `normalize("NFD")`: descomponer "á" en dos code points corre todos los índices siguientes,
 * y los índices son justamente lo que se necesita para recortar el texto ORIGINAL. El reemplazo 1:1
 * mantiene la posición de cada carácter.
 */
const SIN_TILDE: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n",
  à: "a", è: "e", ì: "i", ò: "o", ù: "u", â: "a", ê: "e", î: "i", ô: "o", û: "u",
}

function normalizar(s: string): string {
  return s.toLowerCase().replace(/[áéíóúüñàèìòùâêîôû]/g, (c) => SIN_TILDE[c] ?? c)
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Parte el plan en trozos, marcando los que mencionan un alérgeno registrado.
 *
 * Sin coincidencias devuelve un solo trozo con todo el texto, así que quien lo pinta no necesita
 * un camino aparte para el caso normal.
 */
export function marcarAlergenos(
  texto: string,
  alergias: AlergiaRegistrada[],
  /**
   * Tramos que no se pueden partir. El plan viene con citas `[n]` y negritas `**…**`, y cortar a
   * mitad de una deja los asteriscos sueltos en pantalla. Un hallazgo que toque uno de estos tramos
   * se ESTIRA para cubrirlo entero, así el trozo marcado sigue siendo renderizable — y el alérgeno
   * en negrita se resalta igual, en vez de perderse.
   *
   * Quién los calcula es quien conoce el formato (`rich-text.tsx`): este módulo no sabe de markdown.
   */
  zonasIntactas: { desde: number; hasta: number }[] = [],
): TrozoDePlan[] {
  const completo = [{ texto, alergeno: null }]
  if (!texto || alergias.length === 0) return completo

  const plano = normalizar(texto)
  // Salvavidas: si alguna regla de `toLowerCase` cambiara el largo (pasa con alfabetos que no son
  // el nuestro), los índices dejarían de corresponder y el recorte partiría palabras por la mitad.
  // Mejor no marcar nada: la línea de advertencia sigue estando y no se rompe el texto.
  if (plano.length !== texto.length) return completo

  type Hallazgo = { desde: number; hasta: number; alergia: AlergiaRegistrada }
  const hallazgos: Hallazgo[] = []

  for (const alergia of alergias) {
    const termino = normalizar(alergia.allergen.trim())
    // Un alérgeno de una o dos letras coincidiría con media nota. No se marca.
    if (termino.length < 3) continue
    // `(?:e?s)?` cubre el plural: la alergia dice "penicilina" y el plan escribe "penicilinas".
    //
    // Los límites son lookarounds y NO `\b`. Con `\b` un alérgeno que termina en símbolo —"sulfa
    // (cotrimoxazol)", que es como se escriben de verdad en una ficha— no coincidía NUNCA: `\b`
    // exige un carácter de palabra a un lado, y después del paréntesis viene un espacio. O sea que
    // la alarma se apagaba en silencio justo para los nombres compuestos.
    //
    // "No hay letra ni dígito pegado" dice lo que se quería decir desde el principio, y sigue
    // cubriendo el caso que importa: "penicilina" NO se enciende dentro de "amoxicilina".
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])${escaparRegex(termino)}(?:e?s)?(?![\\p{L}\\p{N}])`,
      "gu",
    )
    for (const m of plano.matchAll(re)) {
      let desde = m.index
      let hasta = m.index + m[0].length
      // Estirar hasta cubrir cualquier token que el hallazgo toque, aunque sea de refilón.
      for (const z of zonasIntactas) {
        if (z.desde < hasta && z.hasta > desde) {
          desde = Math.min(desde, z.desde)
          hasta = Math.max(hasta, z.hasta)
        }
      }
      hallazgos.push({ desde, hasta, alergia })
    }
  }

  if (hallazgos.length === 0) return completo

  // Por posición, y descartando lo que se solape con un hallazgo ya aceptado: dos alergias que
  // comparten prefijo marcarían el mismo tramo dos veces y el recorte saldría desordenado.
  hallazgos.sort((a, b) => a.desde - b.desde || b.hasta - a.hasta)

  const trozos: TrozoDePlan[] = []
  let cursor = 0
  for (const h of hallazgos) {
    if (h.desde < cursor) continue
    if (h.desde > cursor) trozos.push({ texto: texto.slice(cursor, h.desde), alergeno: null })
    trozos.push({ texto: texto.slice(h.desde, h.hasta), alergeno: h.alergia })
    cursor = h.hasta
  }
  if (cursor < texto.length) trozos.push({ texto: texto.slice(cursor), alergeno: null })
  return trozos
}

/** "penicilina (severa) · polen (leve)" — para la línea de advertencia al pie del plan. */
export function resumenDeAlergias(alergias: AlergiaRegistrada[]): string {
  return alergias
    .map((a) => {
      const sev = SEVERIDAD_ALERGIA[a.severity]
      return sev ? `${a.allergen} (${sev})` : a.allergen
    })
    .join(" · ")
}

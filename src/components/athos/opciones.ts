// Parsing compartido del texto de VetGPT: las marcas internas y el bloque ```opciones```.
//
// Vivía solo en `asistente/assistant.tsx`, y la auditoría del 26-ago encontró el costo: el WIDGET
// y el ONBOARDING —que pegan a la misma ruta con el mismo system prompt— pintaban el bloque del
// cuestionario CRUDO (un fence con JSON) y las marcas [[propuesto:…]] tal cual. Una sola copia,
// tres superficies.

import type { PreguntaDeContexto } from "@/components/athos/cuestionario"

/**
 * Quita las marcas `[[propuesto:…]]` / `[[sin-propuesta:…]]` que se persisten con el turno.
 * Son contexto PARA EL MODELO, no contenido para el veterinario (ver conversacion.ts).
 */
export function sinMarcas(texto: string): string {
  return texto
    .replace(/\s*\[\[propuesto:[^\]]*\]\]/g, "")
    .replace(/\s*\[\[sin-propuesta:[^\]]*\]\]/g, "")
    .trim()
}

// El bloque puede NO estar al final (el modelo a veces desobedece el "al FINAL" del prompt):
// terminado el mensaje, se busca bien formado en cualquier posición y se recorta igual —
// mostrar JSON crudo porque el modelo escribió una frase después del fence es castigar al vet
// por un desliz del modelo (hallazgo BAJA de la auditoría 26-ago).
const OPCIONES_AL_FINAL = /```opciones\s*\n?([\s\S]*?)```\s*$/
const OPCIONES_DONDE_SEA = /```opciones\s*\n?([\s\S]*?)```/

function parsear(crudo: string): PreguntaDeContexto[] | null {
  try {
    const arr: unknown = JSON.parse(crudo)
    if (!Array.isArray(arr)) return null
    // Formato viejo: strings sueltos = una sola pregunta sin enunciado.
    if (arr.every((x): x is string => typeof x === "string") && arr.length) {
      return [{ pregunta: "", opciones: arr.slice(0, 5) }]
    }
    const objetos = arr.filter(
      (x): x is PreguntaDeContexto =>
        typeof x === "object" && x !== null &&
        typeof (x as PreguntaDeContexto).pregunta === "string" &&
        Array.isArray((x as PreguntaDeContexto).opciones) &&
        (x as PreguntaDeContexto).opciones.every((o) => typeof o === "string"),
    )
    return objetos.length
      ? objetos.slice(0, 3).map((p) => ({ ...p, opciones: p.opciones.slice(0, 5) }))
      : null
  } catch {
    return null // JSON malformado: mejor mostrar el texto tal cual que romper la respuesta
  }
}

/**
 * Separa el cuestionario ```opciones``` del texto visible.
 *
 * DURANTE el streaming, un bloque sin cerrar es un bloque llegando: se oculta la cola para que el
 * vet no vea JSON escribiéndose. TERMINADO el mensaje, un bloque sin cerrar es un malformado y se
 * muestra crudo (feo gana a invisible — el "se quedó en blanco" del 25-ago salía de ocultarlo).
 */
export function extraerOpciones(
  texto: string,
  streaming: boolean,
): { limpio: string; preguntas: PreguntaDeContexto[] } {
  const m = (streaming ? OPCIONES_AL_FINAL : OPCIONES_DONDE_SEA).exec(texto)
  if (!m) {
    if (streaming) return { limpio: texto.replace(/```opciones[\s\S]*$/, "").trimEnd(), preguntas: [] }
    return { limpio: texto, preguntas: [] }
  }
  const preguntas = parsear(m[1])
  if (!preguntas) return { limpio: texto, preguntas: [] }
  const limpio = (texto.slice(0, m.index) + texto.slice(m.index + m[0].length)).trim()
  return { limpio, preguntas }
}

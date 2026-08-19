// Cómo se llama una consulta.
//
// POR QUÉ CAMBIA. Hasta ahora el título era el "motivo de consulta" que el veterinario escribía
// ANTES de empezar. En la reunión del 17-ago se decidió sacarlo del inicio, y la razón la dio la
// propia dinámica de una consulta: el motivo que el titular declara en la puerta —"viene decaído"—
// casi nunca es de lo que terminó tratándose, y escribirlo es un formulario entre el vet y el
// animal que ya está sobre la mesa.
//
// La propuesta de Jesús fue titular DESPUÉS, desde la nota SOAP: cuando la consulta terminó ya se
// sabe de qué fue.
//
// LO QUE ESTO NO ES: no reescribe la historia clínica ni toca la nota. Es una etiqueta para las
// listas y el encabezado — el contenido clínico sigue siendo el SOAP, íntegro y aprobado por el vet.
//
// Y LAS CONSULTAS VIEJAS CONSERVAN SU MOTIVO. Hay meses de consultas con `chief_complaint` escrito
// a mano; si el motivo existe, manda. Sólo se deriva cuando no hay.

/** Cuánto puede medir un título antes de dejar de servir como etiqueta en una lista. */
export const MAX_TITULO = 60

/**
 * Muletillas con las que un modelo empieza una evaluación clínica.
 *
 * Se recortan porque no distinguen NADA: si las cuarenta consultas de la semana empiezan con
 * "Cuadro clínico compatible con", la lista es una columna de la misma frase y el título deja de
 * ser un título. Lo que sigue a la muletilla es lo que identifica al caso.
 */
const MULETILLAS = [
  /^cuadro cl[íi]nico compatible con\s+/i,
  /^cuadro cl[íi]nico (que\s+)?sugiere\s+/i,
  /^hallazgos compatibles con\s+/i,
  /^(el\s+)?paciente presenta\s+/i,
  /^se observa[n]?\s+/i,
  /^compatible con\s+/i,
  /^sugestivo de\s+/i,
  /^impresi[óo]n diagn[óo]stica:\s*/i,
  /^presunci[óo]n diagn[óo]stica:\s*/i,
]

/**
 * La primera oración de un texto.
 *
 * Corta en punto seguido de espacio, no en cualquier punto: "1.5 mg" y "Dr. Pérez" no son finales
 * de oración, y partir ahí produce títulos truncados a la mitad de una cifra.
 */
function primeraOracion(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim()
  const corte = limpio.search(/[.;]\s/)
  return corte === -1 ? limpio : limpio.slice(0, corte)
}

/**
 * Recorta a `MAX_TITULO` SIN partir una palabra.
 *
 * Un título cortado a la mitad de una palabra se lee como un error del sistema; cortado en el
 * espacio anterior, se lee como un resumen.
 */
function recortar(texto: string): string {
  if (texto.length <= MAX_TITULO) return texto
  const cortado = texto.slice(0, MAX_TITULO)
  const ultimoEspacio = cortado.lastIndexOf(" ")
  return `${(ultimoEspacio > 20 ? cortado.slice(0, ultimoEspacio) : cortado).trimEnd()}…`
}

/** Mayúscula inicial sin tocar el resto: "vómitos crónicos" -> "Vómitos crónicos", "IBD" queda. */
function capitalizar(texto: string): string {
  return texto ? texto[0].toUpperCase() + texto.slice(1) : texto
}

/**
 * Deriva un título de un texto clínico. `null` si no da para uno.
 *
 * EL PISO DE TRES PALABRAS no es arbitrario: con menos, lo que sale son fragmentos como "en gato" o
 * "sin hallazgos" que ocupan la misma línea que un título y no dicen nada. Es mejor caer al
 * siguiente candidato — o a "Consulta" — que titular con ruido.
 */
export function derivarTitulo(texto: string | null | undefined): string | null {
  if (!texto?.trim()) return null

  let frase = primeraOracion(texto)
  for (const muletilla of MULETILLAS) {
    const sinMuletilla = frase.replace(muletilla, "")
    if (sinMuletilla !== frase) {
      frase = sinMuletilla
      break
    }
  }

  frase = frase.replace(/^[\s,;:–—-]+/, "").trim()
  if (frase.split(/\s+/).filter(Boolean).length < 3) return null

  return recortar(capitalizar(frase))
}

export type FuentesDelTitulo = {
  /** El motivo escrito a mano. Si existe, manda: es lo que el vet decidió llamarle. */
  chiefComplaint?: string | null
  /** La "A" del SOAP: donde la nota nombra el cuadro. Es el mejor candidato. */
  assessment?: string | null
  /** La "S": lo que se relató. Sirve cuando la evaluación quedó vacía o fue inconclusa. */
  subjective?: string | null
}

/**
 * Cómo se llama esta consulta, en orden de preferencia.
 *
 *   1. el motivo escrito a mano (consultas anteriores al cambio, o si alguien lo escribe)
 *   2. la evaluación de la nota — de qué resultó ser
 *   3. lo relatado — de qué se habló
 *   4. "Consulta", que es honesto: todavía no hay nota y nadie escribió nada
 */
export function tituloDeLaConsulta(f: FuentesDelTitulo): string {
  const manual = f.chiefComplaint?.trim()
  if (manual) return recortar(manual)

  return derivarTitulo(f.assessment) ?? derivarTitulo(f.subjective) ?? "Consulta"
}

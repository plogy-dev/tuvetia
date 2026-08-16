// El briefing diario: lo único de la capa agéntica que gasta IA.
//
// QUÉ HACE EL MODELO ACÁ, Y QUÉ NO. Sólo REDACTA. Las señales ya vienen calculadas y contadas por
// `lib/senales/`, que no gasta un token; el modelo las convierte en dos frases que se leen de un
// vistazo. No decide qué es importante, no consulta la base y no propone acciones — si esta llamada
// falla o está apagada, las señales se siguen viendo en el riel exactamente igual.
//
// Esa separación no es estética: es lo que permite que el briefing sea opcional y barato. Un
// briefing que DECIDIERA no se podría apagar sin perder información.
//
// La decisión de si vale la pena llamar al modelo vive acá y es pura, para poder probarla sin base
// ni red — que es justo lo que hay que poder probar cuando algo cuesta plata.

import type { Pendiente } from "@/lib/senales/pendientes"

export type InsumosDelBriefing = {
  /** Las señales de la clínica, ya calculadas. */
  pendientes: Pendiente[]
  /** Citas de hoy, con su hora y a quién. */
  citas: { hora: string; etiqueta: string }[]
  /** Nombre de la clínica, para que el texto no hable de "la veterinaria" a secas. */
  clinica?: string | null
}

/**
 * ¿Vale la pena gastar una llamada al modelo?
 *
 * NO, cuando no hay nada que contar. Un briefing que diga "hoy no tenés nada pendiente" cuesta lo
 * mismo que uno útil y no le sirve a nadie: la ausencia de pendientes ya se ve sola en el riel, que
 * no pinta la sección.
 *
 * Esta guarda está ACÁ y no en el prompt porque tiene que evitar la LLAMADA, no la respuesta. Un
 * modelo al que se le pide "no digas nada si no hay nada" igual cobra los tokens de leer el pedido.
 */
export function valeLaPenaRedactar(i: InsumosDelBriefing): boolean {
  return i.pendientes.length > 0 || i.citas.length > 0
}

/**
 * El pedido que se le manda al modelo.
 *
 * TODO LO QUE NECESITA VA EN EL PEDIDO: no tiene herramientas, no consulta nada y no puede
 * verificar lo que le dijimos. Eso es a propósito — un briefing que saliera a buscar datos podría
 * contradecir al riel, y ya sabemos cómo termina eso (la insignia de evidencia que decía lo
 * contrario del juez).
 */
export function pedidoDelBriefing(i: InsumosDelBriefing): string {
  const pendientes = i.pendientes.length
    ? i.pendientes.map((p) => `- ${p.etiqueta} (${p.detalle})`).join("\n")
    : "- (nada pendiente)"

  const citas = i.citas.length
    ? i.citas.map((c) => `- ${c.hora} · ${c.etiqueta}`).join("\n")
    : "- (sin citas hoy)"

  return [
    `Sos Athos, el asistente de ${i.clinica ?? "la clínica"}. Escribí el resumen del día para el`,
    "veterinario que acaba de abrir la plataforma.",
    "",
    "PENDIENTES:",
    pendientes,
    "",
    "CITAS DE HOY:",
    citas,
    "",
    "REGLAS:",
    "- Dos o tres frases. Se lee de un vistazo, no es un informe.",
    "- Usá SÓLO los datos de arriba. No inventes pacientes, cifras ni motivos de consulta.",
    "- Empezá por lo que tiene a alguien esperando, que es como vienen ordenados los pendientes.",
    "- Hablale de vos, directo y sin saludar: el saludo ya está arriba en la pantalla.",
    "- Nada de listas ni viñetas: son frases seguidas.",
    "- Si algo no está en los datos de arriba, no existe. No cierres ofreciendo ayuda.",
  ].join("\n")
}

/**
 * Limpia lo que el modelo devuelve.
 *
 * Recorta a un párrafo y quita viñetas: el prompt las prohíbe, pero un prompt no es una garantía —
 * es una preferencia. Lo que entra a la pantalla se controla acá.
 */
export function limpiarBriefing(texto: string): string {
  return texto
    .trim()
    .replace(/^[-*•]\s*/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

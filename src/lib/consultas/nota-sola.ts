// ¿La nota se pide sola al abrir la consulta?
//
// ── LA HISTORIA: DOS ARREGLOS QUE NO ARREGLARON ───────────────────────────────────────────────
//
// `generating_note` es el estado que el backend deja al terminar de transcribir, y de él sólo se
// salía cuando un humano apretaba «Generar sugerencia». El 22-ago se encontraron CUATRO consultas
// atascadas ahí y se arregló cambiando la etiqueta («Generando nota» → «Falta generar la nota»),
// bajo la teoría de que el vet esperaba porque la pantalla le decía que la máquina trabajaba.
//
// Medido el 25-ago: SEIS atascadas, y tres son POSTERIORES al cambio de etiqueta. La teoría era
// incompleta: un paso que sólo avanza a mano se queda quieto se llame como se llame.
//
// Por eso ahora la nota se pide SOLA al abrir la consulta. No rompe la regla de aprobación humana
// (athos-service/CLAUDE.md §5): lo que se genera es un BORRADOR, y sigue sin entrar nada a la
// historia hasta que el vet lo apruebe. Lo que se elimina es el clic previo al borrador, que no
// decidía nada — nadie abre una consulta transcrita para NO querer la nota.
//
// ── POR QUÉ UNA FUNCIÓN PURA ──────────────────────────────────────────────────────────────────
//
// La condición vive acá y no inline en la pantalla porque es la parte que se puede equivocar en
// silencio: dispararse sin transcripción (el backend rechazaría), o con nota ya hecha (pisarla), o
// en un estado que no es el suyo (una consulta abierta sin grabar). La pantalla decide CUÁNDO
// preguntar; esto decide QUÉ responder, y tiene test.

export type FotoDeLaConsulta = {
  status: string | null | undefined
  hayTranscripcion: boolean
  hayNota: boolean
}

/**
 * `true` si al abrir esta consulta hay que pedir el borrador sin esperar un clic.
 *
 * Sólo en `generating_note`: es el único estado que significa «transcripción lista, nota no
 * pedida». En `open` no hay qué resumir, en `transcribing` el material está a medias, y de
 * `review`/`completed` ya hay nota — volver a generar ahí es una decisión del vet (el botón de
 * reintento sigue existiendo), no un automatismo.
 */
export function laNotaSePideSola(foto: FotoDeLaConsulta): boolean {
  return foto.status === "generating_note" && foto.hayTranscripcion && !foto.hayNota
}

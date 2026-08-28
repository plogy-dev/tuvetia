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
  /**
   * Se INTENTÓ transcribir y quedó una fila, pero sin una sola palabra.
   *
   * Es distinto de «todavía no hay transcripción»: acá el audio se subió, el proveedor contestó y
   * lo que contestó fue nada. Sin este dato las dos situaciones se ven iguales desde afuera, que es
   * exactamente lo que dejó cuatro consultas muertas.
   */
  transcripcionVacia?: boolean
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

/**
 * La grabación terminó y no capturó ni una palabra: no hay nada que resumir.
 *
 * ── EL AGUJERO QUE DEJARON LOS TRES ARREGLOS ANTERIORES ───────────────────────────────────────
 *
 * Éste es el CUARTO paso sobre el mismo atasco, y los tres anteriores lo esquivaron sin verlo:
 * dos cambiaron la etiqueta y el tercero automatizó la generación al abrir. Pero la automatización
 * se apoya en `laNotaSePideSola`, que exige `hayTranscripcion` — y una transcripción VACÍA no
 * cuenta. Con toda la razón: pedirle un SOAP a un texto en blanco es lo que producía las notas que
 * se disculpaban por no tener información.
 *
 * El problema es lo que pasa después: la condición se apaga, nadie genera nada, el estado no se
 * mueve, y la lista sigue prometiendo «se genera al abrirla». Se puede abrir cien veces y no pasa
 * nada. Medido el 27-ago: de las nueve consultas colgadas, CUATRO son de éstas — con audio de 6 a
 * 26 segundos y una fila de transcripción en blanco detrás.
 *
 * Y la pantalla remataba el callejón ofreciendo «Generar sugerencia a partir de la transcripción»:
 * un botón que no puede funcionar, sin decir nunca por qué.
 *
 * ── POR QUÉ ES UNA FUNCIÓN Y NO UN `if` EN LA PANTALLA ────────────────────────────────────────
 *
 * Porque es la MISMA foto que decide si la nota se pide sola, y las dos ramas tienen que repartirse
 * el mismo espacio sin dejar hueco: o se genera, o se dice por qué no. Un `if` suelto en el render
 * se desincroniza del otro en el primer cambio.
 *
 * `athos-service` ya no crea nuevas —desde el 27-ago una transcripción vacía es un fallo y no un
 * éxito sin palabras (`test_transcripcion_vacia.py`)— pero las que quedaron sólo salen por acá.
 */
export function laGrabacionNoCapturoNada(foto: FotoDeLaConsulta): boolean {
  return (
    foto.status === "generating_note" &&
    !foto.hayNota &&
    !foto.hayTranscripcion &&
    foto.transcripcionVacia === true
  )
}

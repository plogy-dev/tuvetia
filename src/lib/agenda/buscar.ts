// Buscar una cita dentro de lo que ya está en pantalla.
//
// ── QUÉ BUSCA, Y POR QUÉ ESOS TRES CAMPOS ──────────────────────────────────────────────────────
//
// El paciente, el título y el motivo. Es por lo que se busca una cita en el mostrador: «¿a qué hora
// era lo de Luna?», «¿cuándo entra la castración?». Nadie busca una cita por su id ni por su estado.
//
// ── FILTRA AL PINTAR, NO CONSULTA ──────────────────────────────────────────────────────────────
//
// Se aplica sobre las citas que el calendario YA tiene cargadas —las del rango que se está
// mirando—, así que escribir no cuesta un viaje por tecla. La contrapartida hay que decirla: no
// encuentra citas de otra semana. Es lo correcto para un buscador que vive DENTRO de la vista de
// agenda: el resultado tiene que ser algo que se pueda ver ahí mismo, resaltado en su día y su
// hora. Un buscador global es otra cosa, y ya existe arriba en la barra del panel.

/** Lo mínimo de una cita que hace falta para buscarla. */
export type CitaBuscable = {
  title: string | null
  reason: string | null
  patient: { name: string } | null
}

/**
 * Sin acentos y en minúsculas.
 *
 * Es lo que hace que buscar «bruno» encuentre «Brunö» y que «vacunacion» encuentre «vacunación» —
 * que es como se escribe cuando hay alguien esperando del otro lado del mostrador.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

/**
 * ¿Esta cita coincide con lo que se escribió?
 *
 * Una consulta vacía deja pasar TODO, y esa dirección importa: si devolviera `false`, la agenda
 * aparecería en blanco hasta escribir algo. El caso normal de este campo es estar vacío.
 *
 * Se parte en palabras y se exigen TODAS. Escribir «luna vacuna» tiene que encontrar la vacunación
 * de Luna y no todas las citas de Luna más todas las vacunaciones de la semana: con una sola
 * palabra el filtro no filtra, y con dos es cuando de verdad se lo necesita.
 */
export function coincideConLaBusqueda(cita: CitaBuscable, consulta: string): boolean {
  const q = normalizar(consulta)
  if (!q) return true

  const heno = normalizar(
    [cita.patient?.name, cita.title, cita.reason].filter(Boolean).join(" "),
  )
  return q.split(/\s+/).every((palabra) => heno.includes(palabra))
}

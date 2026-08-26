// Cuándo se le escribe al titular al guardar una cita.
//
// ── EL DEFECTO QUE CIERRA ──────────────────────────────────────────────────────────────────────
//
// La confirmación salía en CADA guardado. Abrir una cita para corregirle una tilde al motivo le
// mandaba al titular otro «¡Listo! La cita quedó agendada para el…», idéntico al de ayer. La 0091
// se ahorró el sello de enviado razonando que «lo dispara UNA acción de una persona» — cierto, y
// editar también es una acción de una persona. El razonamiento tapaba el caso.
//
// ── LA REGLA, Y POR QUÉ ES ÉSTA Y NO «SÓLO AL CREAR» ───────────────────────────────────────────
//
// Cortar en «sólo al crear» es una línea y arregla el spam, pero abre algo peor: el vet mueve la
// cita del martes al jueves y el titular se sigue guiando por el martes. Un aviso de más es una
// molestia; un cliente que llega el día equivocado porque nadie le avisó es la cita perdida.
//
// Entonces se avisa cuando CAMBIÓ LA HORA, que es el único dato del que depende que el titular
// aparezca. Cambiarle el motivo, las notas o el veterinario no cambia cuándo tiene que estar, así
// que no se le escribe.
//
// NO SE INVENTA UN TEXTO NUEVO para el cambio de hora. La plantilla de la clínica dice la fecha y
// la hora nuevas, así que se lee bien igual; una segunda plantilla significaría otro campo de
// configuración que alguien tiene que redactar y mantener, para una diferencia de matiz.
//
// PURO Y SIN RED: `vitest.config.mts` corre en `environment: "node"` sobre `src/**/*.test.ts`.

/**
 * Los estados en los que un «quedó agendada» tiene sentido.
 *
 * Mandarlo al pasar una cita a `cancelled` sería decirle al titular que su cita está en pie
 * justo cuando se acaba de caer — el peor mensaje posible, y en el peor momento.
 */
const ESTADOS_QUE_AVISAN = new Set(["scheduled", "confirmed"])

export type GuardadoDeCita = {
  esEdicion: boolean
  /** Cómo queda la cita guardada. */
  status: string
  /** Un bloqueo no tiene titular: no hay a quién escribirle. */
  esBloqueo: boolean
  /** El inicio ANTES de editar. `null` al crear. */
  inicioAnterior: string | null
  /** El inicio con el que queda guardada. */
  inicioNuevo: string
}

/**
 * ¿Hay que mandarle la confirmación al titular por este guardado?
 *
 * Devuelve `false` de más antes que `true` de más: el costo de no avisar por algo menor es que el
 * titular se entera en la próxima interacción; el de avisar de más es escribirle a un cliente real
 * un mensaje que no pidió, y eso ya pasó.
 */
export function hayQueAvisar(g: GuardadoDeCita): boolean {
  // Un bloqueo no lleva titular ni teléfono. Sin esto, cada almuerzo reservado terminaba pidiéndole
  // al proveedor de WhatsApp un envío imposible y pintándole al vet un renglón rojo de fallo en la
  // ventana de aviso, por algo que nunca tuvo destinatario.
  if (g.esBloqueo) return false
  if (!ESTADOS_QUE_AVISAN.has(g.status)) return false
  if (!g.esEdicion) return true
  return cambioLaHora(g.inicioAnterior, g.inicioNuevo)
}

/**
 * Si el inicio se movió, comparado COMO INSTANTE y no como texto.
 *
 * La cita viene de la base en ISO con zona (`2026-09-01T15:00:00+00:00`) y del formulario armada
 * desde un `datetime-local`. Los dos pueden nombrar el mismo instante con distinto texto, y una
 * comparación de cadenas leería eso como un cambio de hora: volvería a mandar el aviso en cada
 * guardado, que es exactamente el defecto que esto viene a cerrar.
 */
function cambioLaHora(anterior: string | null, nuevo: string): boolean {
  if (!anterior) return true
  const a = new Date(anterior).getTime()
  const b = new Date(nuevo).getTime()
  // Una fecha ilegible se trata como cambio: ante la duda, que el titular se entere. Es el único
  // lugar donde conviene errar hacia el aviso — no saber si se movió la cita es peor que un
  // mensaje repetido.
  if (Number.isNaN(a) || Number.isNaN(b)) return true
  return a !== b
}

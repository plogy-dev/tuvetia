// De qué es cada cita.
//
// ── POR QUÉ HACE FALTA ─────────────────────────────────────────────────────────────────────────
//
// El «motivo» es texto libre, y como texto libre no se puede contar: la misma vacunación se escribe
// «vacuna», «Vacunacion anual», «refuerzo triple» y «VAC». Con eso no hay forma de responder cuántas
// vacunaciones hizo la clínica este mes, que es de lo primero que se pregunta.
//
// El tipo NO reemplaza al motivo: lo clasifica. El motivo sigue siendo lo que el vet escribe y lo
// que le llega al titular en el WhatsApp; el tipo es la etiqueta con la que se agrupa.
//
// ── LA LISTA ───────────────────────────────────────────────────────────────────────────────────
//
// Sale del desplegable de OkVet, más `control` y `urgencia` —que son las dos que más aparecen
// escritas a mano en el motivo— y `bloqueo`, que es lo que se pone solo al reservar un espacio.
//
// El orden NO es alfabético: es por frecuencia. Un desplegable se lee de arriba hacia abajo y lo que
// más se elige tiene que estar donde cae la vista, no donde lo pone el diccionario.
//
// PURO Y SIN `server-only`: lo consumen el drawer (cliente), la grilla y cualquier reporte. Es la
// misma regla que `lib/planes/index.ts` — los datos que usan las dos mitades no llevan `server-only`.

export type TipoDeCita =
  | "consulta_general"
  | "consulta_especializada"
  | "vacunacion"
  | "desparasitacion"
  | "control"
  | "cirugia"
  | "urgencia"
  | "laboratorio"
  | "imagenes"
  | "peluqueria"
  | "bloqueo"
  | "otro"

export type DefinicionDeTipo = {
  id: TipoDeCita
  label: string
  /**
   * El color del bloque en la grilla.
   *
   * ES UN TOKEN Y NO UN HEX. La app tiene tema claro y oscuro, y un `#22c55e` escrito acá sería un
   * verde que en modo oscuro grita. Los tokens ya están calibrados para los dos.
   */
  color: string
  /** Minutos que dura por defecto. Elegir el tipo ajusta el fin de la cita. */
  minutos: number
}

/**
 * Los tipos, en orden de frecuencia.
 *
 * `bloqueo` no está acá: no se elige en el desplegable, se pone solo al marcar «sólo reservar el
 * espacio». Ofrecerlo como un tipo más dejaría crear una cita de tipo bloqueo CON paciente, que es
 * justamente lo que la 0093 rechaza — un camino que la interfaz ofrece y la base rebota.
 */
export const TIPOS_DE_CITA: DefinicionDeTipo[] = [
  { id: "consulta_general", label: "Consulta general", color: "var(--color-brand)", minutos: 30 },
  { id: "control", label: "Control", color: "var(--color-info)", minutos: 20 },
  { id: "vacunacion", label: "Vacunación", color: "var(--color-ok)", minutos: 20 },
  { id: "desparasitacion", label: "Desparasitación", color: "var(--color-ok)", minutos: 15 },
  { id: "consulta_especializada", label: "Consulta especializada", color: "var(--color-brand-deep)", minutos: 45 },
  { id: "cirugia", label: "Cirugía", color: "var(--color-danger)", minutos: 90 },
  { id: "urgencia", label: "Urgencia", color: "var(--color-danger)", minutos: 45 },
  { id: "laboratorio", label: "Examen de laboratorio", color: "var(--color-accent)", minutos: 20 },
  { id: "imagenes", label: "Imágenes diagnósticas", color: "var(--color-accent)", minutos: 30 },
  { id: "peluqueria", label: "Peluquería o spa", color: "var(--color-amber)", minutos: 60 },
  { id: "otro", label: "Otro", color: "var(--color-fg-muted)", minutos: 30 },
]

/** El bloqueo, aparte: no se elige, se marca. */
export const TIPO_BLOQUEO: DefinicionDeTipo = {
  id: "bloqueo",
  label: "Espacio reservado",
  color: "var(--color-fg-faint)",
  minutos: 60,
}

const POR_ID = new Map<string, DefinicionDeTipo>(
  [...TIPOS_DE_CITA, TIPO_BLOQUEO].map((t) => [t.id, t]),
)

/**
 * La definición de un tipo, o `null` si no se reconoce.
 *
 * Devuelve `null` y no un tipo por defecto a propósito: las citas creadas ANTES de la 0093 no tienen
 * tipo, y pintarlas todas como «consulta general» sería inventarles un dato. Sin tipo, la cita se
 * pinta por su ESTADO, que es como se pintaba antes de todo esto.
 */
export function tipoDeCita(id: string | null | undefined): DefinicionDeTipo | null {
  return id ? (POR_ID.get(id) ?? null) : null
}

/** El nombre legible, para una tabla o un informe. `—` cuando no hay tipo. */
export function nombreDelTipo(id: string | null | undefined): string {
  return tipoDeCita(id)?.label ?? "—"
}

/**
 * El fin que le corresponde a una cita según su tipo.
 *
 * Elegir «Cirugía» tiene que mover el fin a hora y media: dejarlo en los 30 minutos por defecto
 * hace que el vet agende una cirugía encima de la consulta siguiente y lo descubra el día de la
 * cirugía.
 */
export function finSegunTipo(inicioISO: string, id: string | null | undefined): string | null {
  const def = tipoDeCita(id)
  if (!def) return null
  const inicio = new Date(inicioISO)
  if (Number.isNaN(inicio.getTime())) return null
  return new Date(inicio.getTime() + def.minutos * 60_000).toISOString()
}

// De quién son las citas que se ven en la agenda.
//
// LO QUE SE ACORDÓ: un interruptor entre "mi agenda" y la de toda la clínica. La agenda cargaba
// TODAS las citas del consultorio mezcladas, así que con cuatro veterinarios cada uno veía tres
// agendas ajenas encima de la suya — y el propio día se volvía ilegible justo en la pantalla que
// existe para leer el día.
//
// La cita ya sabe de quién es (`appointments.vet_id`); lo que faltaba era poder mirarlas de a una.
//
// ── LA DECISIÓN QUE NO ES OBVIA: LAS CITAS SIN ASIGNAR ──────────────────────────────────────────
//
// Una cita sin veterinario no es de nadie, así que por lógica no debería estar en "mi agenda". Pero
// si se esconde ahí, deja de aparecer en la vista por defecto de TODAS las personas de la clínica:
// nadie la ve hasta que alguien se acuerda de mirar la vista completa, y una cita que nadie mira es
// una cita a la que no va nadie.
//
// Entre "aparece de más" y "no aparece para nadie", en una agenda clínica la primera es la falla
// barata. Se muestran, y la interfaz las cuenta aparte para que se puedan asignar.

export type FiltroDeAgenda = "mia" | "clinica"

/** Lo mínimo que hace falta saber de una cita para filtrarla. */
export type CitaFiltrable = { vet_id?: string | null }

/**
 * Las citas que se ven, según el interruptor.
 *
 * `mia` sin saber quién soy devuelve todo: es preferible a dejar la agenda en blanco por un dato
 * que no llegó. Una agenda vacía se lee como "no tengo nada hoy", que es la mentira más cara que
 * puede decir esta pantalla.
 */
export function citasVisibles<T extends CitaFiltrable>(
  citas: readonly T[],
  filtro: FiltroDeAgenda,
  miId: string | null | undefined,
): T[] {
  if (filtro === "clinica" || !miId) return [...citas]
  return citas.filter((c) => c.vet_id === miId || !c.vet_id)
}

/** Cuántas están sin asignar. Se muestra para que alguien las reclame, no como adorno. */
export function sinAsignar(citas: readonly CitaFiltrable[]): number {
  return citas.filter((c) => !c.vet_id).length
}

/** Cuántas son de otras personas. Es lo que el interruptor está escondiendo, y conviene decirlo. */
export function deOtros(citas: readonly CitaFiltrable[], miId: string | null | undefined): number {
  if (!miId) return 0
  return citas.filter((c) => c.vet_id && c.vet_id !== miId).length
}

// ── Quién puede mirar la agenda de los demás ────────────────────────────────────────────────────
//
// LO QUE SE PIDIÓ, Luciano el 19-ago: que ver toda la agenda sea permiso de administrador — *"que
// ese permiso se pueda otorgar"*. Las dos mitades importan: que no lo tenga cualquiera, y que un
// admin pueda dárselo a quien corresponda **sin volverlo admin de todo**.
//
// EL INTERRUPTOR YA EXISTÍA, pero lo tenía todo el mundo y no escondía nada de verdad: la pantalla
// se traía las citas de la clínica entera y el filtro las tapaba en el navegador. O sea que "mi
// agenda" era una vista, no un límite — las citas de los demás viajaban igual en la página.
//
// Ahora el permiso decide DOS cosas, y ninguna sirve sin la otra: si el interruptor aparece, y qué
// citas pide la consulta. Sin la segunda, esto sería un cartel.

/** Lo que hace falta saber de quien mira para decidir qué agenda ve. */
export type QuienMira = {
  role: string | null | undefined
  ve_agenda_completa?: boolean | null
}

/**
 * ¿Puede ver la agenda de toda la clínica?
 *
 * UN ADMIN SIEMPRE PUEDE, sin necesidad de la bandera. Si hubiera que otorgársela también a él, la
 * primera persona de una clínica nueva —que es admin por ser quien la creó— se quedaría sin ver la
 * agenda de nadie y sin nadie que pudiera dárselo.
 */
export function puedeVerLaAgendaCompleta(quien: QuienMira | null | undefined): boolean {
  if (!quien) return false
  return quien.role === "admin" || quien.ve_agenda_completa === true
}

/**
 * El filtro con el que la PANTALLA pide las citas, ya no el que las tapa después.
 *
 * Devuelve `null` cuando no hay que acotar nada. Quien no tiene el permiso recibe sólo las suyas y
 * las que no son de nadie — las sin asignar siguen viajando a propósito: esconderlas las dejaría
 * fuera de la vista por defecto de TODAS las personas de la clínica, y una cita que nadie mira es
 * una cita a la que no va nadie.
 */
export function filtroDeConsulta(
  quien: QuienMira | null | undefined,
  miId: string | null | undefined,
): string | null {
  if (puedeVerLaAgendaCompleta(quien)) return null
  if (!miId) return null
  return `vet_id.eq.${miId},vet_id.is.null`
}

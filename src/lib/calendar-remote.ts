// Borrado del evento en el calendario externo (Google Calendar u Outlook) al eliminar una cita.
//
// EL ORDEN IMPORTA Y ES EL PUNTO DE TODO ESTE MÓDULO: esto se llama **antes** de borrar la fila de
// `appointments`. Antes se hacía al revés —primero se borraba la fila, después se avisaba a los
// calendarios— y por eso el navegador tenía que mandar el id del evento y el dueño: la fila ya no
// existía para consultarlos. Ese diseño abría un agujero: nada ataba ese id de evento a ninguna
// cita, así que se podía pedir el borrado de un evento cualquiera del calendario personal de un
// colega. Llamando antes, alcanza con mandar el id de la cita y que el servidor lea el resto.
//
// Es BEST-EFFORT a propósito. Si Google no responde, la cita se borra igual de Tuvetia: una cita que
// no se puede eliminar de la app porque un proveedor externo está caído es peor que un evento
// huérfano en un calendario.

export type ResultadoBorradoRemoto = { ok: boolean; errores: string[] }

async function pedirBorrado(url: string, appointmentId: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appointmentId }),
    })
    if (res.ok) return null
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    return j.error ?? `HTTP ${res.status}`
  } catch (e) {
    return (e as Error).message
  }
}

/**
 * Pide el borrado del evento. Una sola ruta para los dos proveedores: cuál usar lo resuelve el
 * servidor mirando en qué columna quedó el id del evento. Es un no-op si la cita nunca llegó a un
 * calendario.
 */
export async function borrarEventosRemotos(appointmentId: string): Promise<ResultadoBorradoRemoto> {
  const error = await pedirBorrado("/api/calendario/delete", appointmentId)
  return { ok: error === null, errores: error ? [error] : [] }
}

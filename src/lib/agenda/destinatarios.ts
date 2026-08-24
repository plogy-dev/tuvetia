// En el calendario de QUIÉN vive el evento, y a quién se invita.
//
// ── LO QUE CAMBIÓ (v5) ──────────────────────────────────────────────────────────────────────────
//
// Hasta v4 había UN calendario por clínica —el del administrador— y todos los demás iban invitados.
// El pedido ahora es que los dos roles puedan conectar el suyo, y eso obliga a contestar una
// pregunta que antes no existía: si todos tienen calendario, ¿en cuál se crea el evento?
//
// LA RESPUESTA: EN EL DEL VETERINARIO ASIGNADO. Es lo único que le da sentido a que un vet conecte
// el suyo — una invitación le llega al correo aunque no haya conectado nada, así que si el evento
// no se CREA en su calendario, conectarlo no cambiaría absolutamente nada para él. Con esto su
// calendario queda espejando su agenda de Tuvetia, que es la misma regla que ya gobierna todo lo
// demás: `appointments.vet_id` es quien decide de quién es una cita.
//
// ── POR QUÉ ESTA VEZ SÍ, SI v3 YA LO HABÍA INTENTADO ────────────────────────────────────────────
//
// v3 puso el evento en el calendario del vet asignado y se revirtió por un motivo concreto: el
// administrador —que es quien agenda y quien mira la agenda de la clínica— no lo veía en ningún
// lado. Se reportó como "no crea nada" cuando sí creaba.
//
// Lo que arregla ese defecto no es volver el evento al admin: es INVITAR A TODOS LOS ADMINS. Así el
// admin sigue teniendo la clínica entera en su calendario —le llegan todas las citas, igual que
// antes— y además el vet tiene la suya. Las dos cosas a la vez, que es lo que v3 no tenía.
//
// ── LA RED DE SEGURIDAD ─────────────────────────────────────────────────────────────────────────
//
// Si el vet asignado no conectó calendario, el evento cae al del administrador en vez de no
// crearse. Sin ese respaldo, el día que entra alguien nuevo al equipo sus citas dejarían de llegar
// a cualquier calendario y nadie se enteraría hasta que un titular no aparezca.
//
// PURO Y SIN RED, como el resto de `lib/agenda/`: `vitest.config.mts` corre en `environment: "node"`
// sobre `src/**/*.test.ts`. Las consultas las hace `composio/calendario.ts`; decidir quién hospeda y
// quién va invitado es esto, y se puede probar.

/**
 * En qué calendarios se intenta crear el evento, EN ORDEN.
 *
 * El primero que tenga calendario conectado gana. Devuelve una lista y no un id porque quién
 * hospeda no se sabe sin preguntarle al proveedor si esa persona conectó algo, y eso es una
 * consulta de red que no va acá.
 */
export function candidatosAAnfitrion(
  vetId: string | null | undefined,
  adminDeLaClinica: string | null | undefined,
): string[] {
  const orden = [vetId, adminDeLaClinica].filter((id): id is string => Boolean(id))
  return [...new Set(orden)]
}

/**
 * Los perfiles que van INVITADOS: todos los admins, el veterinario asignado y quien creó la cita.
 *
 * SE EXCLUYE AL ANFITRIÓN, y no es cosmético: es el organizador del evento, ya lo tiene en su
 * calendario, y los dos proveedores tratan raro que el organizador figure además como invitado
 * (Graph lo rechaza en algunos casos, Google le manda una invitación a sí mismo).
 *
 * El titular NO sale de acá: no es un perfil de la clínica, su correo vive en `owners.email` y lo
 * agrega `correosDeInvitados`.
 */
export function perfilesAInvitar({
  anfitrionId,
  adminIds,
  vetId,
  creadorId,
}: {
  anfitrionId: string
  adminIds: readonly (string | null | undefined)[]
  vetId: string | null | undefined
  creadorId: string | null | undefined
}): string[] {
  const todos = [...adminIds, vetId, creadorId].filter((id): id is string => Boolean(id))
  return [...new Set(todos)].filter((id) => id !== anfitrionId)
}

/**
 * La lista final de correos a invitar: el titular primero, después el equipo.
 *
 * SE NORMALIZA Y SE DEDUPLICA POR CORREO, además de por id. Son cosas distintas: dos perfiles
 * pueden compartir casilla, y un titular que además trabaja en la clínica aparecería dos veces. Un
 * invitado repetido no rompe el evento, pero le llegan dos invitaciones a la misma persona y eso se
 * lee como que el sistema está roto.
 *
 * Cualquiera puede faltar —un titular sin correo cargado, un perfil sin cuenta— y se omite en vez de
 * hacer fallar el push: la cita en el calendario vale aunque falte una invitación.
 */
export function correosDeInvitados(
  correosDelEquipo: readonly (string | null | undefined)[],
  correoDelTitular: string | null | undefined,
): string[] {
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const crudo of [correoDelTitular, ...correosDelEquipo]) {
    const email = (crudo ?? "").trim()
    if (!email) continue
    const clave = email.toLowerCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    salida.push(email)
  }
  return salida
}

/**
 * La dirección de la clínica en una línea, o `null` si no está cargada.
 *
 * Va al campo `location` del evento —que es lo que el teléfono del titular convierte en un enlace a
 * mapas— y también al cuerpo. Ver `composio/calendario.ts` para por qué en los dos lados.
 */
export function direccionDeLaClinica(
  clinica: { address?: string | null; city?: string | null } | null | undefined,
): string | null {
  const partes = [clinica?.address, clinica?.city]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
  return partes.length ? partes.join(", ") : null
}

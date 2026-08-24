// De quién es el calendario de RESPALDO de la clínica. UNA regla, y por eso vive acá.
//
// DESDE v5 CADA CITA SE CREA EN EL CALENDARIO DEL VETERINARIO ASIGNADO. Esto sigue haciendo falta
// para el caso en que ese veterinario no conectó ninguno: entonces el evento cae en el del
// administrador, y hay que saber quién es —para empujar la cita allá, y para poder nombrarlo en
// pantalla.
//
// EL DEFECTO QUE ARREGLA. La respuesta estaba escrita dos veces, distinto:
//
//   · `composio/calendario.ts` —al EMPUJAR la cita— usaba `clinics.owner_id` y, si no había,
//     caía al primer perfil `admin`.
//   · `dashboard/conexiones/page.tsx` —al decidir QUIÉN PUEDE CONECTARLO— usaba sólo `owner_id`.
//
// En una clínica sin `owner_id` (las anteriores a la migración 0048) eso deja el peor estado
// posible: las citas se empujan al calendario del primer admin, y ese admin **nunca ve el botón
// para conectarlo**. Nadie recibe invitaciones y no hay nada en pantalla que explique por qué.
//
// Que las dos mitades no puedan volver a separarse es el punto del módulo: si mañana cambia el
// criterio, cambia acá y cambia en los dos lados a la vez.
//
// Puro y sin cliente de base: recibe lo que ya se leyó. `vitest.config.mts` corre en
// `environment: "node"`.

/** Lo mínimo que hace falta saber de un perfil para elegirlo. */
export type PerfilCandidato = {
  id: string
  full_name?: string | null
}

/**
 * Quién es el administrador del calendario, con el respaldo.
 *
 * `owner_id` MANDA cuando está. Es quien creó la clínica (migración 0048) y es una decisión
 * explícita; el primer `admin` es una inferencia, y una inferencia no le gana a un dato.
 *
 * EL RESPALDO NO ES DECORATIVO: sin él, una clínica anterior a la 0048 no tiene a nadie que pueda
 * conectar el calendario, y sus citas no llegan a ningún lado sin ningún motivo visible.
 */
export function quienTieneElCalendario(
  ownerId: string | null | undefined,
  primerAdmin?: PerfilCandidato | null,
): string | null {
  return ownerId ?? primerAdmin?.id ?? null
}

/**
 * ¿Quien está mirando es el administrador del calendario de la clínica?
 *
 * SE LLAMABA `puedeConectarElCalendario` HASTA v5, y el nombre dejó de ser cierto: ahora el
 * conector se le muestra a todo el mundo, porque cada cita se crea en el calendario del veterinario
 * asignado y conectar el propio le sirve a cualquiera. Esto ya no gobierna un botón.
 *
 * LO QUE SIGUE RESPONDIENDO, y por eso no se borró: si a esta persona le toca ser el calendario de
 * RESPALDO de la clínica — donde caen las citas de quien todavía no conectó el suyo. Es lo que
 * decide qué se le explica en pantalla, no qué se le permite.
 *
 * Se compara contra el resultado de `quienTieneElCalendario` y no contra `owner_id` a secas — que
 * es exactamente la diferencia que dejaba al primer `admin` sin botón cuando el botón importaba.
 */
export function esElAdministradorDelCalendario(
  userId: string | null | undefined,
  administrador: string | null,
): boolean {
  return Boolean(userId && administrador && administrador === userId)
}

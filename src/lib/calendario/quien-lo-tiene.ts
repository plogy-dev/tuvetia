// De quién es el calendario de la clínica. UNA regla, y por eso vive acá.
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
 * ¿Quien está mirando es el que puede conectarlo?
 *
 * Se compara contra el resultado de `quienTieneElCalendario` y no contra `owner_id` a secas — que
 * es exactamente la diferencia que dejaba al primer `admin` sin botón.
 */
export function puedeConectarElCalendario(
  userId: string | null | undefined,
  administrador: string | null,
): boolean {
  return Boolean(userId && administrador && administrador === userId)
}

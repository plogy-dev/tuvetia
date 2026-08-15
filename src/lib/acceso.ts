// Qué le corresponde ver a alguien que acaba de entrar.
//
// POR QUÉ ES UNA FUNCIÓN Y NO UN `if` EN CADA PANTALLA. La decisión se toma en DOS lugares que
// tienen que coincidir —`dashboard/layout.tsx` y `bienvenida/page.tsx`— y ya se desincronizaron una
// vez: el layout mandaba a bienvenida cuando faltaba la clínica, y bienvenida rebotaba al dashboard
// por tener `setup_completed_at`, con los dos redirigiéndose para siempre. El comentario de
// `bienvenida/page.tsx` documenta ese lazo y el orden que lo evita; acá ese orden está escrito una
// sola vez y con test.
//
// El caso nuevo es `desactivada`, y es el que obliga a separarlo: con el gate de la migración 0059
// un perfil inactivo no tiene clínica desde el punto de vista de la RLS, así que sin distinguirlo
// se vería EXACTAMENTE igual que un usuario sin clínica — y a un veterinario al que le desactivaron
// la cuenta la app le diría "no tienes clínica", que se lee como "tus datos se perdieron".

/** Lo que la app necesita saber del perfil para decidir. */
export type PerfilDeAcceso = {
  /** `profiles.is_active`. Sólo es legible desde la 0059, que dejó ver la fila propia siempre. */
  is_active?: boolean | null
  clinic_id: string | null
  setup_completed_at: string | null
} | null

export type EstadoDeAcceso =
  /** Perfil desactivado: no entra, y hay que decírselo con esas palabras. */
  | "desactivada"
  /** No tiene clínica: invitación sin aceptar, o el trigger de alta que no corrió. */
  | "sin-clinica"
  /** Tiene clínica pero no terminó el wizard. */
  | "onboarding"
  /** Todo en orden. */
  | "activo"

/**
 * El orden importa y no es cosmético.
 *
 * `desactivada` va PRIMERO: con el gate puesto, un perfil inactivo llega acá con la clínica en null
 * —la RLS ya no se la muestra— así que preguntarlo después lo clasificaría como `sin-clinica` y le
 * ofrecería crear una clínica nueva. Justo lo que la desactivación existe para impedir.
 *
 * Después `sin-clinica` antes que `onboarding`, que es el orden que ya evitaba el lazo de
 * redirecciones: el backfill de la migración 0017 puso `setup_completed_at` a TODOS los perfiles,
 * incluidos los que no tenían clínica.
 *
 * Un perfil que no se pudo leer (`null`) se trata como `sin-clinica`, que es el comportamiento de
 * siempre: manda al onboarding, que sabe atender ese caso.
 */
export function estadoDeAcceso(perfil: PerfilDeAcceso): EstadoDeAcceso {
  // `=== false` y no `!perfil.is_active`: la columna puede venir `undefined` cuando el select no la
  // pidió, y eso NO es una cuenta desactivada. Sólo un `false` explícito lo es.
  if (perfil?.is_active === false) return "desactivada"
  if (!perfil?.clinic_id) return "sin-clinica"
  if (!perfil.setup_completed_at) return "onboarding"
  return "activo"
}

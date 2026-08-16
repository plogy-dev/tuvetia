// El único lugar por donde se reporta un error no atrapado.
//
// POR QUÉ EXISTE ESTE ARCHIVO Y NO UN `console.error` SUELTO EN CADA BOUNDARY. Hoy no hay servicio
// de tracking contratado, así que esto sólo escribe a consola — pero los tres boundaries llaman
// acá, así que enchufar Sentry (o el que se elija) es tocar UNA función y no buscar los `console`
// desperdigados. Mientras tanto, al menos el error queda con forma: dónde pasó y con qué digest.
//
// QUÉ ES EL DIGEST. En producción Next NO manda el mensaje real del error al navegador — sería
// filtrar detalle del servidor a cualquiera. Manda un hash corto, el `digest`, que aparece también
// en los logs del servidor. Es lo único que conecta "lo que vio el vet" con "lo que pasó de
// verdad", así que la pantalla de error TIENE que mostrarlo: sin él, un reporte de usuario es
// imposible de rastrear.

/** Dónde se cayó. Sirve para distinguir un fallo de página de uno del layout raíz. */
export type DondeFallo = "raiz" | "dashboard" | "global"

const ETIQUETA: Record<DondeFallo, string> = {
  raiz: "app",
  dashboard: "dashboard",
  global: "layout-raiz",
}

/**
 * Reporta un error no atrapado.
 *
 * Se llama desde un `useEffect` en el boundary, no durante el render: React puede re-renderizar un
 * boundary más de una vez y reportar en el cuerpo duplicaría el evento.
 *
 * PARA ENCHUFAR SENTRY: instalar `@sentry/nextjs`, y acá dentro agregar
 * `Sentry.captureException(error, { tags: { donde }, extra: { digest: error.digest } })`.
 * No hace falta tocar ningún boundary.
 */
export function reportarError(error: Error & { digest?: string }, donde: DondeFallo): void {
  console.error(`[tuvetia:${ETIQUETA[donde]}]`, {
    mensaje: error.message,
    digest: error.digest ?? null,
    stack: error.stack ?? null,
  })
}

/**
 * Texto corto para que el vet pueda reportar el fallo.
 *
 * Devuelve `null` cuando no hay digest —pasa en desarrollo, donde el mensaje real sí viaja— para
 * que la pantalla no muestre un "código: null" que no le sirve a nadie.
 */
export function codigoDeReporte(error: { digest?: string }): string | null {
  return error.digest ?? null
}

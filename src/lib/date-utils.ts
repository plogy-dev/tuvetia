// Utilidades de fecha ancladas a la zona del negocio (America/Bogota, UTC-5
// fijo, sin DST). Portado del repo cliente — solo lo que consumen las libs de
// facturación/cartera.

/** Fecha de "hoy" YYYY-MM-DD vista desde Bogotá. */
export function bogotaTodayISO(now: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
}

/** Hora HH:mm de un instante ISO, vista desde America/Bogota. */
export function bogotaTimeOf(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

// Formateo para las pantallas clínicas. Va acá y no inline en cada página porque el defecto que
// esto corrige nace de omitir `timeZone`: los server components de Next corren en UTC en Vercel, así
// que una consulta de las 19:00 en Bogotá se renderizaba **con la fecha del día siguiente**. El
// veterinario veía la consulta de ayer fechada hoy. Cualquier fecha que se le muestre al usuario
// tiene que pasar por acá.

/** "01 ago 2026" — fecha de un instante ISO, vista desde Bogotá. */
export function bogotaDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * "01 ago 2026" — para columnas **DATE** (`YYYY-MM-DD`), que no llevan hora ni zona.
 *
 * Existe porque el arreglo de arriba, aplicado a una columna DATE, produce el defecto INVERSO.
 * `new Date('2026-08-01')` se parsea como medianoche **UTC**; formatearlo en Bogotá (UTC-5) lo
 * retrocede al 31 de julio. O sea que una vacuna aplicada el 1 se mostraba con fecha del 31, y
 * además con un "19:00" que en una columna sin hora no significa nada.
 *
 * Una fecha DATE ya está en el calendario del negocio: no hay que convertirla, hay que formatearla.
 * Por eso se arma desde las partes y se fija `timeZone: 'UTC'`, que neutraliza cualquier corrimiento.
 */
export function bogotaDateOnly(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  if (!y || !m || !d) return fecha;
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "01 ago 2026, 19:30" — fecha y hora de un instante ISO, vistas desde Bogotá. */
export function bogotaDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

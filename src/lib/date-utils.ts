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

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

// Formatos de presentación del módulo de facturación (es-CO).

import { bogotaDateOnly } from '@/lib/date-utils';

export { formatCOP, pesosToCents } from '@/lib/facturacion/domain/money';

/** Sólo fecha, sin hora: `2026-08-15`. Es la forma de las columnas DATE (`due_date`, `issued_on`). */
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  // Una columna DATE no tiene hora ni zona: ya está en el calendario del negocio. Convertirla a
  // Bogotá la RETROCEDE un día, porque `new Date('2026-08-15')` se parsea como medianoche UTC.
  // Por eso `due_date` se imprimía como "14 de ago" en el detalle de la factura y en cartera.
  // `bogotaDateOnly` (lib/date-utils) existe desde el 01-ago justo para esto; este módulo era el
  // único que no lo usaba. La detección va acá y no en cada llamador porque `fmtDate` recibe las
  // dos clases de fecha y son 20+ sitios.
  if (typeof d === 'string' && SOLO_FECHA.test(d)) return bogotaDateOnly(d);
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });
}

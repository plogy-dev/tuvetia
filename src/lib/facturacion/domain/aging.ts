// Antigüedad de cartera (aging): reparte los saldos por vencidos por tramos.
// Puro y determinista (now inyectado). Estándar de cobranza: corriente (no
// vencido) / 1-30 / 31-60 / 61-90 / 90+ días de vencimiento.

export interface AgingInput {
  balanceCents: number;
  dueDate: string | null; // YYYY-MM-DD o ISO
}

export interface AgingBucket {
  amountCents: number;
  count: number;
}

export interface Aging {
  corriente: AgingBucket; // no vencido o sin fecha
  d1_30: AgingBucket;
  d31_60: AgingBucket;
  d61_90: AgingBucket;
  d90plus: AgingBucket;
  totalOverdueCents: number;
  totalCents: number;
}

const MS_DAY = 24 * 60 * 60 * 1000;

function empty(): AgingBucket {
  return { amountCents: 0, count: 0 };
}

/** Días de vencimiento por CALENDARIO (>0 vencido) a la fecha `now`. Vencer hoy
 *  no cuenta como vencido todavía. */
export function daysOverdue(dueDate: string | null, now: Date): number {
  if (!dueDate) return 0;
  const due = new Date(`${dueDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) return 0;
  const nowMid = new Date(now);
  nowMid.setHours(0, 0, 0, 0);
  return Math.floor((nowMid.getTime() - due.getTime()) / MS_DAY);
}

export function computeAging(items: AgingInput[], now: Date): Aging {
  const aging: Aging = {
    corriente: empty(),
    d1_30: empty(),
    d31_60: empty(),
    d61_90: empty(),
    d90plus: empty(),
    totalOverdueCents: 0,
    totalCents: 0,
  };
  for (const it of items) {
    if (it.balanceCents <= 0) continue;
    aging.totalCents += it.balanceCents;
    const d = daysOverdue(it.dueDate, now);
    let bucket: AgingBucket;
    if (d <= 0) bucket = aging.corriente;
    else if (d <= 30) bucket = aging.d1_30;
    else if (d <= 60) bucket = aging.d31_60;
    else if (d <= 90) bucket = aging.d61_90;
    else bucket = aging.d90plus;
    bucket.amountCents += it.balanceCents;
    bucket.count += 1;
    if (d > 0) aging.totalOverdueCents += it.balanceCents;
  }
  return aging;
}

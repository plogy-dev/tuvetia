// Lógica PURA del panel de ingresos y egresos (finanzas). Sin Supabase ni
// Next: testeable en unit tests. Ingresos = payments (ya existentes);
// egresos = expenses (0030). Agrupación mensual en TZ America/Bogota.

export const EXPENSE_CATEGORIES = [
  'COMPRA_INVENTARIO',
  'NOMINA',
  'ARRIENDO',
  'SERVICIOS_PUBLICOS',
  'HONORARIOS',
  'IMPUESTOS',
  'MANTENIMIENTO',
  'PUBLICIDAD',
  'BANCARIOS',
  'OTRO',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  COMPRA_INVENTARIO: 'Compra de inventario',
  NOMINA: 'Nómina',
  ARRIENDO: 'Arriendo',
  SERVICIOS_PUBLICOS: 'Servicios públicos',
  HONORARIOS: 'Honorarios',
  IMPUESTOS: 'Impuestos',
  MANTENIMIENTO: 'Mantenimiento',
  PUBLICIDAD: 'Publicidad',
  BANCARIOS: 'Gastos bancarios',
  OTRO: 'Otro',
};

export interface IncomeEntry {
  amountCents: number;
  /** timestamptz ISO de payments.received_at. */
  at: string;
}

export interface ExpenseEntry {
  amountCents: number;
  /** date `YYYY-MM-DD` de expenses.expense_date. */
  date: string;
  category: string;
}

export interface FinanceSummary {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  /** Meses ordenados ascendente, `YYYY-MM` en TZ Bogotá. */
  byMonth: { month: string; incomeCents: number; expenseCents: number }[];
  /** Solo egresos, ordenado por monto descendente. */
  byCategory: { category: string; amountCents: number }[];
}

/** `YYYY-MM` de un timestamptz ISO, en hora de Bogotá (UTC-5, sin DST). */
export function monthKeyBogota(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  // Bogotá es UTC-5 fijo (Colombia no tiene horario de verano).
  const bogota = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  const y = bogota.getUTCFullYear();
  const m = String(bogota.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** `YYYY-MM` de un date plano `YYYY-MM-DD` (ya es fecha local del vet). */
function monthKeyFromDate(date: string): string {
  return date.slice(0, 7);
}

export function computeFinanceSummary(
  income: IncomeEntry[],
  expenses: ExpenseEntry[],
): FinanceSummary {
  const incomeCents = income.reduce((s, i) => s + i.amountCents, 0);
  const expenseCents = expenses.reduce((s, e) => s + e.amountCents, 0);

  const months = new Map<string, { incomeCents: number; expenseCents: number }>();
  const bump = (key: string, field: 'incomeCents' | 'expenseCents', amount: number) => {
    const cur = months.get(key) ?? { incomeCents: 0, expenseCents: 0 };
    cur[field] += amount;
    months.set(key, cur);
  };
  for (const i of income) bump(monthKeyBogota(i.at), 'incomeCents', i.amountCents);
  for (const e of expenses) bump(monthKeyFromDate(e.date), 'expenseCents', e.amountCents);

  const byMonth = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const cats = new Map<string, number>();
  for (const e of expenses) cats.set(e.category, (cats.get(e.category) ?? 0) + e.amountCents);
  const byCategory = [...cats.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([category, amountCents]) => ({ category, amountCents }));

  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    byMonth,
    byCategory,
  };
}

export interface FinanceCsvRow {
  date: string;
  kind: 'INGRESO' | 'EGRESO';
  concept: string;
  method: string;
  amountCents: number;
}

/**
 * CSV del período. Montos en pesos SIN separador de miles (para que Excel/CO
 * no los malinterprete) y separador de campos `;` (convención es-CO).
 */
export function financeCsv(rows: FinanceCsvRow[]): string {
  // Además de ; y comillas, se neutraliza el PREFIJO de fórmula (=, +, -, @): el concepto incluye
  // texto libre (nota, proveedor) y también lo rellena la importación con IA — un valor que
  // empiece por "=" se EJECUTA al abrir el CSV en Excel/LibreOffice (CSV injection). El apóstrofo
  // inicial es el escape estándar de hoja de cálculo: se muestra el texto tal cual, sin ejecutar.
  const esc = (s: string) => {
    const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[;"\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
  };
  const lines = ['Fecha;Tipo;Concepto;Método;Monto (COP)'];
  for (const r of rows) {
    const pesos = Math.round(r.amountCents / 100) * (r.kind === 'EGRESO' ? -1 : 1);
    lines.push([r.date, r.kind, esc(r.concept), esc(r.method), String(pesos)].join(';'));
  }
  return lines.join('\n');
}

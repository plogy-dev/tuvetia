import { formatCOP } from '@/lib/facturacion/domain/money';

/**
 * Barras mensuales ingresos vs egresos, sin librería de charts (divs puros).
 * Presentacional: recibe los meses ya agregados por computeFinanceSummary.
 */
export function FinanceBars({
  data,
}: {
  data: { month: string; incomeCents: number; expenseCents: number }[];
}) {
  if (data.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-fg-faint">
        Sin movimientos todavía en los últimos meses.
      </p>
    );
  }

  const max = Math.max(1, ...data.flatMap((d) => [d.incomeCents, d.expenseCents]));
  const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-CO', {
      month: 'short',
      timeZone: 'America/Bogota',
    });
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center gap-4 text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-ok" /> Ingresos
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-warn" /> Egresos
        </span>
      </div>
      <div className="flex items-end gap-3 sm:gap-5">
        {data.map((d) => (
          <div key={d.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex h-32 w-full items-end justify-center gap-1">
              <div
                className="w-3 rounded-t bg-ok sm:w-4"
                style={{ height: `${Math.max(2, (d.incomeCents / max) * 100)}%` }}
                title={`Ingresos ${monthLabel(d.month)}: ${formatCOP(d.incomeCents)}`}
              />
              <div
                className="w-3 rounded-t bg-warn sm:w-4"
                style={{ height: `${Math.max(2, (d.expenseCents / max) * 100)}%` }}
                title={`Egresos ${monthLabel(d.month)}: ${formatCOP(d.expenseCents)}`}
              />
            </div>
            <span className="text-[11px] text-fg-faint">{monthLabel(d.month)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

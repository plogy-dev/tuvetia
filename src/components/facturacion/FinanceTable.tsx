'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDownCircle, ArrowUpCircle, Download, Paperclip, Pencil, Trash2 } from 'lucide-react';
import {
  deleteExpenseAction,
  getExpenseAttachmentUrlAction,
} from '@/lib/facturacion/expenses/actions';
import { deleteIncomeAction } from '@/lib/facturacion/payments/actions';
import { financeCsv, type FinanceCsvRow } from '@/lib/facturacion/domain/finance';
import { formatCOP } from '@/lib/facturacion/domain/money';

export interface FinanceItem {
  id: string;
  kind: 'INGRESO' | 'EGRESO';
  /** `YYYY-MM-DD` para ordenar/mostrar. */
  date: string;
  concept: string;
  method: string;
  amountCents: number;
  /** Solo egresos. */
  hasAttachment?: boolean;
  /** Egreso generado por una compra: no se borra desde acá. */
  fromPurchase?: boolean;
  /** Ingreso aplicado a una factura: se gestiona desde la factura. */
  appliedToInvoice?: boolean;
  /** URL para abrir el form de edición (la arma el server con los filtros). */
  editHref?: string;
  /** Destino al clicar la fila (factura del pago aplicado, compra del egreso). */
  href?: string;
}

/** Tabla combinada de ingresos y egresos del período + export CSV. */
export function FinanceTable({ items }: { items: FinanceItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove(item: FinanceItem) {
    // Mismo criterio que ImportBatchesList: borrar dinero registrado es irreversible y el icono
    // vive a 4px del lápiz de editar — un clic mal puesto no puede borrar sin preguntar.
    const label = item.kind === 'EGRESO' ? 'este egreso' : 'este ingreso';
    if (!window.confirm(`¿Eliminar ${label} (${item.concept})? No se puede deshacer.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r =
        item.kind === 'EGRESO'
          ? await deleteExpenseAction({ id: item.id })
          : await deleteIncomeAction({ id: item.id });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function openAttachment(id: string) {
    setError(null);
    // La ventana se abre DENTRO del gesto del usuario (síncrono). Abrirla después del await la
    // dejaba fuera del contexto del clic y el bloqueador de popups la mataba en Safari/Chrome
    // estricto — el clip del comprobante "no hacía nada", sin error. Sin el flag 'noopener' en
    // esta rama porque hace que window.open devuelva null; el opener se corta a mano.
    const win = window.open('about:blank', '_blank');
    if (win) win.opener = null;
    startTransition(async () => {
      const r = await getExpenseAttachmentUrlAction({ id });
      if (!r.ok) {
        win?.close();
        setError(r.error);
        return;
      }
      if (win) win.location.href = r.url;
      else window.open(r.url, '_blank', 'noopener');
    });
  }

  function exportCsv() {
    const rows: FinanceCsvRow[] = items.map((i) => ({
      date: i.date,
      kind: i.kind,
      concept: i.concept,
      method: i.method,
      amountCents: i.amountCents,
    }));
    // BOM para que Excel abra el CSV con acentos correctos.
    const blob = new Blob(['﻿' + financeCsv(rows)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ingresos-egresos-${items[0]?.date ?? 'periodo'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">
          {items.length === 1 ? '1 movimiento' : `${items.length} movimientos`} en el período
        </p>
        <button
          type="button"
          disabled={items.length === 0}
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted hover:text-fg transition disabled:opacity-50"
        >
          <Download className="size-3.5" aria-hidden />
          Exportar CSV
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-warn bg-surface-2 px-3 py-2 text-sm text-warn">{error}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        {items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-fg-faint">
            Sin movimientos en el período seleccionado.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-faint">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-2 py-2 font-medium">Tipo</th>
                <th className="px-2 py-2 font-medium">Concepto</th>
                <th className="px-2 py-2 font-medium">Método</th>
                <th className="px-2 py-2 text-right font-medium">Monto</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr
                  key={`${i.kind}-${i.id}`}
                  onClick={(e) => {
                    if (!i.href) return;
                    if ((e.target as HTMLElement).closest('a,button')) return;
                    router.push(i.href);
                  }}
                  className={`border-b border-line/60 last:border-0 ${
                    i.href ? 'cursor-pointer hover:bg-surface-2/50' : ''
                  }`}
                >
                  <td className="px-4 py-2 font-mono text-xs tabular-nums text-fg-muted">
                    {i.date}
                  </td>
                  <td className="px-2 py-2">
                    {i.kind === 'INGRESO' ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-ok/40 px-2 py-0.5 text-[11px] font-medium text-ok">
                        <ArrowUpCircle className="size-3" aria-hidden />
                        Ingreso
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 px-2 py-0.5 text-[11px] font-medium text-warn">
                        <ArrowDownCircle className="size-3" aria-hidden />
                        Egreso
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-fg">{i.concept}</td>
                  <td className="px-2 py-2 text-xs text-fg-muted">
                    {i.method.charAt(0) + i.method.slice(1).toLowerCase()}
                  </td>
                  <td
                    className={`px-2 py-2 text-right font-mono text-xs tabular-nums ${
                      i.kind === 'INGRESO' ? 'text-ok' : 'text-warn'
                    }`}
                  >
                    {i.kind === 'INGRESO' ? '+' : '−'}
                    {formatCOP(i.amountCents)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex items-center gap-1">
                      {i.kind === 'EGRESO' && i.hasAttachment && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => openAttachment(i.id)}
                          title="Ver comprobante"
                          className="rounded p-1 text-fg-faint hover:text-fg transition"
                        >
                          <Paperclip className="size-3.5" aria-hidden />
                        </button>
                      )}
                      {i.editHref && (
                        <Link
                          href={i.editHref}
                          title={i.kind === 'EGRESO' ? 'Editar gasto' : 'Editar ingreso'}
                          className="rounded p-1 text-fg-faint hover:text-fg transition"
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </Link>
                      )}
                      {((i.kind === 'EGRESO' && !i.fromPurchase) ||
                        (i.kind === 'INGRESO' && !i.appliedToInvoice)) && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => remove(i)}
                          title={i.kind === 'EGRESO' ? 'Eliminar gasto' : 'Eliminar ingreso'}
                          className="rounded p-1 text-fg-faint hover:text-warn transition"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      )}
                      {i.kind === 'EGRESO' && i.fromPurchase && (
                        <span className="text-[10px] text-fg-faint">compra</span>
                      )}
                      {i.kind === 'INGRESO' && i.appliedToInvoice && (
                        <span className="text-[10px] text-fg-faint">factura</span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

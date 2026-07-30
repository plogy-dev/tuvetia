'use client';

import { Download } from 'lucide-react';

export interface MovementCsvRow {
  date: string;
  item: string;
  type: string;
  qty: number;
  unit: string;
  note: string;
}

/** Export CSV client-side de los movimientos visibles (página actual + filtros). */
export function MovementsExport({ rows }: { rows: MovementCsvRow[] }) {
  function exportCsv() {
    const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = ['Fecha;Ítem;Tipo;Cantidad;Unidad;Nota'];
    for (const r of rows) {
      lines.push(
        [r.date, esc(r.item), r.type, String(r.qty), esc(r.unit), esc(r.note)].join(';'),
      );
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `movimientos-inventario-${rows[0]?.date ?? 'periodo'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      disabled={rows.length === 0}
      onClick={exportCsv}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted hover:text-fg transition disabled:opacity-50"
    >
      <Download className="size-3.5" aria-hidden />
      Exportar CSV
    </button>
  );
}

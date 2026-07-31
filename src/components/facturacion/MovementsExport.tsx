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
    // Prefijo de fórmula neutralizado con apóstrofo: nombre de ítem y nota son texto libre, y un
    // "=..." se ejecuta al abrir el CSV en Excel (CSV injection). Igual que financeCsv.
    const esc = (s: string) => {
      const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[;"\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
    };
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
    a.download = `movimientos-pagina-${rows[0]?.date ?? 'actual'}.csv`;
    a.click();
    // Revocar de inmediato compite con el inicio de la descarga en Firefox/Safari.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <button
      type="button"
      disabled={rows.length === 0}
      onClick={exportCsv}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted hover:text-fg transition disabled:opacity-50"
    >
      <Download className="size-3.5" aria-hidden />
      {/* "esta página": exporta las filas VISIBLES (página + filtros). Decirlo en el botón evita
          que alguien se lleve 100 filas creyendo que se llevó los 4.000 movimientos del total. */}
      Exportar esta página (CSV)
    </button>
  );
}

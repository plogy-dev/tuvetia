'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Undo2 } from 'lucide-react';
import { revertImport } from '@/lib/facturacion/import/actions';
import { fmtDateTime } from '@/lib/facturacion/format';
import type { ImportBatchRow } from '@/lib/supabase/types';
import { toast } from "sonner"

const STATUS_LABELS: Record<string, string> = {
  PREVIEW: 'Vista previa (sin confirmar)',
  COMMITTED: 'Confirmada',
  REVERTED: 'Revertida',
};

/** Importaciones pasadas con opción de revertir las confirmadas. */
export function ImportBatchesList({ batches }: { batches: ImportBatchRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (batches.length === 0) return null;

  function revert(batchId: string) {
    if (!window.confirm('¿Revertir esta importación? Se eliminan los ítems y movimientos que creó.')) {
      return;
    }
    setError(null);
    startTransition(async () => {
      // La guarda que devuelve los botones (28-ago): si esta promesa RECHAZA —sesión vencida,
      // red caída, o un id de Server Action viejo tras un deploy— React nunca cierra la
      // transición e `isPending` deja los botones deshabilitados hasta recargar.
      try {
        const r = await revertImport({ batchId });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        router.refresh();
    
      } catch (e) {
        toast.error(`No se pudo completar la acción: ${(e as Error)?.message ?? e}`)
      }
    });
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-faint">
        Importaciones
      </h2>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {batches.map((b) => {
          const rep = b.report ?? {};
          return (
            <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{b.file_name}</p>
                <p className="text-xs text-fg-muted">
                  {STATUS_LABELS[b.status] ?? b.status} · {fmtDateTime(b.created_at)}
                  {typeof rep.total === 'number'
                    ? ` · ${(rep.ready ?? 0) + (rep.withWarnings ?? 0)}/${rep.total} importables`
                    : ''}
                </p>
              </div>
              {b.status === 'COMMITTED' && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => revert(b.id)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-warn transition disabled:opacity-60"
                >
                  <Undo2 className="size-3.5" aria-hidden />
                  Revertir
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="mt-2 flex items-start gap-2 rounded-xl border border-warn bg-surface-2 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </section>
  );
}

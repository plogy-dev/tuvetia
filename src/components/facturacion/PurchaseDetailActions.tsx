'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Pencil, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import {
  annulPurchaseAction,
  confirmPurchaseAction,
  deletePurchaseDraftAction,
  reopenPurchaseAction,
} from '@/lib/facturacion/purchases/actions';

/** Botonera del detalle de compra: confirmar (borrador), anular (confirmada), borrar (borrador). */
export function PurchaseDetailActions({
  purchaseId,
  status,
}: {
  purchaseId: string;
  status: 'BORRADOR' | 'CONFIRMADA' | 'ANULADA';
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, afterPath?: string) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? 'Error');
        return;
      }
      if (afterPath) router.push(afterPath);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-warn bg-surface-2 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {status === 'BORRADOR' && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => confirmPurchaseAction({ id: purchaseId }))}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
            >
              {isPending ? (
                <RefreshCw className="size-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden />
              )}
              Confirmar compra
            </button>
            <Link
              href={`/dashboard/facturacion/compras/${purchaseId}/editar`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:text-fg transition"
            >
              <Pencil className="size-4" aria-hidden />
              Editar
            </Link>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                run(() => deletePurchaseDraftAction({ id: purchaseId }), '/dashboard/facturacion/compras')
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:text-warn transition disabled:opacity-60"
            >
              <Trash2 className="size-4" aria-hidden />
              Borrar borrador
            </button>
            <span className="text-xs text-fg-faint">
              Confirmar suma el stock, actualiza costos y registra el egreso.
            </span>
          </>
        )}
        {status === 'CONFIRMADA' && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                run(
                  () => reopenPurchaseAction({ id: purchaseId }),
                  `/dashboard/facturacion/compras/${purchaseId}/editar`,
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
            >
              {isPending ? (
                <RefreshCw className="size-4 animate-spin" aria-hidden />
              ) : (
                <Pencil className="size-4" aria-hidden />
              )}
              Reabrir para editar
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => annulPurchaseAction({ id: purchaseId }))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-warn/50 bg-surface px-4 py-2 text-sm text-warn hover:bg-surface-2 transition disabled:opacity-60"
            >
              <Undo2 className="size-4" aria-hidden />
              Anular compra
            </button>
            <span className="text-xs text-fg-faint">
              Reabrir revierte stock y egreso para que edites y re-confirmes. Anular los
              elimina definitivamente.
            </span>
          </>
        )}
        {status === 'ANULADA' && (
          <span className="text-sm text-fg-faint">Compra anulada: sin efecto en stock ni finanzas.</span>
        )}
      </div>
    </div>
  );
}

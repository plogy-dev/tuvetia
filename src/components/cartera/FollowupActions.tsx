'use client';

// Acciones de seguimiento en el detalle de una factura emitida con saldo:
// pausar/reanudar, registrar promesa de pago, abrir/cerrar disputa. Cada una
// registra un EVENTO — el estado se deriva, nunca se edita a mano.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CalendarClock, Pause, Play, ShieldAlert } from 'lucide-react';
import {
  registerPromiseToPayAction,
  setDisputeAction,
  setRemindersPausedAction,
} from '@/lib/cartera/actions';

export function FollowupActions({
  invoiceId,
  remindersPaused,
  inDispute,
}: {
  invoiceId: string;
  remindersPaused: boolean;
  inDispute: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [promiseDate, setPromiseDate] = useState('');
  const [showPromise, setShowPromise] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'Error');
      else router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-medium text-fg">Seguimiento</h2>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            run(() => setRemindersPausedAction({ invoiceId, paused: !remindersPaused }))
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg transition disabled:opacity-60"
        >
          {remindersPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {remindersPaused ? 'Reanudar' : 'Pausar'}
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => setShowPromise((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg transition disabled:opacity-60"
        >
          <CalendarClock className="size-3.5" />
          Promesa de pago
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => setDisputeAction({ invoiceId, open: !inDispute }))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-warn transition disabled:opacity-60"
        >
          <ShieldAlert className="size-3.5" />
          {inDispute ? 'Cerrar disputa' : 'Marcar en disputa'}
        </button>
      </div>

      {showPromise && (
        <div className="flex items-center gap-2 pt-1">
          <input
            type="date"
            value={promiseDate}
            onChange={(e) => setPromiseDate(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <button
            type="button"
            disabled={isPending || !promiseDate}
            onClick={() =>
              run(async () => {
                const r = await registerPromiseToPayAction({ invoiceId, until: promiseDate });
                if (r.ok) setShowPromise(false);
                return r;
              })
            }
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
          >
            Registrar hasta esa fecha
          </button>
        </div>
      )}

      <p className="pt-1 text-[11px] text-fg-faint">
        El seguimiento respeta la Ley 2300: horarios, festivos, un contacto al día
        y solo canales autorizados.
      </p>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

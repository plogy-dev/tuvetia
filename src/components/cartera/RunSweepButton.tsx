'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { runSweepNowAction } from '@/lib/cartera/actions';

/** "Ejecutar seguimiento ahora": corre el barrido de cartera del vet a mano. */
export function RunSweepButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setMsg(null);
            const r = await runSweepNowAction();
            if (r.ok) {
              setMsg(
                `Programados ${r.planned} · enviados ${r.sent} · reprogramados ${r.rescheduled} · omitidos ${r.skipped}`,
              );
              router.refresh();
            } else {
              setMsg(r.error);
            }
          })
        }
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition disabled:opacity-60"
      >
        <RefreshCw className={`size-4 ${isPending ? 'animate-spin' : ''}`} aria-hidden />
        {isPending ? 'Ejecutando…' : 'Ejecutar seguimiento ahora'}
      </button>
      {msg && <span className="text-xs text-fg-faint">{msg}</span>}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Check, X } from 'lucide-react';
import { resolveHumanTaskAction } from '@/lib/cartera/actions';
import type { HumanTaskKind } from '@/lib/supabase/types';

const KIND_LABELS: Record<HumanTaskKind, string> = {
  VERIFICAR_COMPROBANTE: 'Verificar comprobante',
  DISPUTA: 'Disputa del cliente',
  SOLICITUD_PLAZO: 'Solicitud de plazo',
  CONTACTO_SOLICITADO: 'Contacto solicitado',
  MENSAJE_NO_ENTREGADO: 'Mensaje no entregado',
  OTRO: 'Otro',
};

export type TaskItem = {
  id: string;
  kind: HumanTaskKind;
  title: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  createdAt: string;
};

export function HumanTasksPanel({ tasks }: { tasks: TaskItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve(taskId: string, status: 'RESUELTA' | 'DESCARTADA') {
    startTransition(async () => {
      const r = await resolveHumanTaskAction({ taskId, status });
      // Antes se descartaba el resultado: una tarea que no se resolvía simplemente reaparecía
      // tras el refresh, sin ninguna pista de por qué.
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-5 text-sm text-fg-faint">
        No hay casos que requieran tu atención. 👌
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="human-tasks">
      {error && (
        <li className="rounded-xl border border-warn bg-surface-2 px-4 py-2 text-xs text-warn">
          {error}
        </li>
      )}
      {tasks.map((t) => (
        <li
          key={t.id}
          className="flex items-start justify-between gap-3 rounded-xl border border-warn/50 bg-surface p-4"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden />
              <span className="text-xs font-medium text-warn">{KIND_LABELS[t.kind]}</span>
              {t.invoiceId && (
                <Link
                  href={`/dashboard/facturacion/${t.invoiceId}`}
                  className="text-xs text-fg-faint underline underline-offset-2 hover:text-fg"
                >
                  {t.invoiceNumber ?? 'factura'}
                </Link>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-fg">{t.title}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={isPending}
              onClick={() => resolve(t.id, 'RESUELTA')}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-ok transition disabled:opacity-60"
            >
              <Check className="size-3.5" aria-hidden />
              Resolver
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => resolve(t.id, 'DESCARTADA')}
              className="inline-flex items-center rounded-lg border border-line bg-surface p-1.5 text-fg-faint hover:bg-surface-2 hover:text-warn transition disabled:opacity-60"
              aria-label="Descartar"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

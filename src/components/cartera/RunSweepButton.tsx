'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { runSweepNowAction } from '@/lib/cartera/actions';
import { toast } from "sonner"

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
        onClick={() => {
          // Este botón CONTACTA CLIENTES de verdad (WhatsApp/correo a deudores) — en un flujo
          // regulado por la Ley 2300, un clic accidental no puede disparar envíos sin preguntar.
          if (
            !window.confirm(
              'Se enviarán ahora los recordatorios de cobro pendientes a los titulares (WhatsApp/correo). ¿Ejecutar el barrido?',
            )
          )
            return;
          startTransition(async () => {
            // La guarda que devuelve los botones (28-ago): si esta promesa RECHAZA —sesión vencida,
            // red caída, o un id de Server Action viejo tras un deploy— React nunca cierra la
            // transición e `isPending` deja los botones deshabilitados hasta recargar.
            try {
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
          
            } catch (e) {
              toast.error(`No se pudo completar la acción: ${(e as Error)?.message ?? e}`)
            }
          });
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition disabled:opacity-60"
      >
        <RefreshCw className={`size-4 ${isPending ? 'animate-spin' : ''}`} aria-hidden />
        {isPending ? 'Ejecutando…' : 'Ejecutar seguimiento ahora'}
      </button>
      {msg && <span className="text-xs text-fg-faint">{msg}</span>}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ArrowDownUp } from 'lucide-react';
import { registerInventoryMovement } from '@/lib/facturacion/actions';
import type { CatalogItemRow } from '@/lib/supabase/types';

/** Registro de movimiento manual de inventario (carga inicial, compra, ajuste…). */
export function MovementForm({ items }: { items: CatalogItemRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const tracked = items.filter((i) => i.track_stock && i.active);

  function run(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    const type = String(fd.get('movementType')) as
      | 'CARGA_INICIAL'
      | 'ENTRADA_COMPRA'
      | 'DEVOLUCION'
      | 'CONSUMO_INTERNO'
      | 'VENCIMIENTO'
      | 'PERDIDA'
      | 'AJUSTE';
    const rawQty = Math.abs(Number(fd.get('qty') ?? 0));
    const outbound = ['CONSUMO_INTERNO', 'VENCIMIENTO', 'PERDIDA'].includes(type);
    const qty = type === 'AJUSTE' ? Number(fd.get('qty') ?? 0) : outbound ? -rawQty : rawQty;
    startTransition(async () => {
      const r = await registerInventoryMovement({
        itemId: String(fd.get('itemId')),
        qty,
        movementType: type,
        note: (fd.get('note') as string) || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOkMsg('Movimiento registrado.');
      form.reset();
      router.refresh();
    });
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
  const labelCls = 'block text-xs font-medium text-fg-muted';

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
          open
            ? 'border-brand bg-brand text-on-brand'
            : 'border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg'
        }`}
      >
        <ArrowDownUp className="size-4" aria-hidden />
        Registrar movimiento
      </button>

      {open && (
        <form onSubmit={run} className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Ítem</label>
            <select name="itemId" required className={inputCls}>
              <option value="">Selecciona…</option>
              {tracked.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Tipo de movimiento</label>
            <select name="movementType" className={inputCls} defaultValue="CARGA_INICIAL">
              <option value="CARGA_INICIAL">Carga inicial (+)</option>
              <option value="ENTRADA_COMPRA">Compra (+)</option>
              <option value="DEVOLUCION">Devolución (+)</option>
              <option value="CONSUMO_INTERNO">Consumo interno (−)</option>
              <option value="VENCIMIENTO">Vencimiento (−)</option>
              <option value="PERDIDA">Pérdida (−)</option>
              <option value="AJUSTE">Ajuste (±)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Cantidad (en unidad de uso)</label>
            <input name="qty" type="number" step="0.25" required className={inputCls} />
            <p className="mt-1 text-[11px] text-fg-faint">
              Para «Ajuste» usa el signo (ej. -2 corrige hacia abajo).
            </p>
          </div>
          <div>
            <label className={labelCls}>Nota (opcional)</label>
            <input name="note" placeholder="Compra proveedor X" className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
            >
              {isPending ? 'Registrando…' : 'Registrar movimiento'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-warn bg-surface-2 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {okMsg && (
        <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ok">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          {okMsg}
        </p>
      )}
    </div>
  );
}

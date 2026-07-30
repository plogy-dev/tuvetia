'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { upsertIncomeAction } from '@/lib/facturacion/payments/actions';

const METHODS = ['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'OTRO'] as const;

const inputCls =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-brand focus:outline-none';
const labelCls = 'block text-xs font-medium text-fg-muted';

export interface IncomeInitial {
  id: string;
  method: string;
  amountPesos: number;
  receivedDate: string;
  note: string | null;
}

/**
 * Alta/edición de un ingreso suelto (pago no ligado a factura). Los pagos de
 * facturas se registran desde la factura, no acá.
 */
export function IncomeForm({
  today,
  initial,
  closeHref,
}: {
  today: string;
  initial?: IncomeInitial | null;
  closeHref?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(!!initial);
  const [error, setError] = useState<string | null>(null);

  const editing = !!initial;

  function close() {
    setOpen(false);
    if (editing && closeHref) router.push(closeHref);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await upsertIncomeAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      formRef.current?.reset();
      close();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-ok/50 bg-surface px-4 py-2 text-sm font-medium text-ok hover:bg-surface-2 transition"
      >
        <Plus className="size-4" aria-hidden />
        Registrar ingreso
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="grid w-full gap-3 rounded-xl border border-line bg-surface-2 p-4 sm:grid-cols-3"
    >
      {editing && (
        <>
          <input type="hidden" name="id" value={initial!.id} />
          <p className="sm:col-span-3 text-sm font-medium text-fg">Editar ingreso</p>
        </>
      )}
      <div>
        <label className={labelCls}>Monto (COP)</label>
        <input
          name="amountPesos"
          type="number"
          min={1}
          step={100}
          required
          defaultValue={initial?.amountPesos}
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>Fecha</label>
        <input
          name="receivedDate"
          type="date"
          required
          defaultValue={initial?.receivedDate ?? today}
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>Método</label>
        <select
          name="method"
          required
          defaultValue={initial?.method ?? 'EFECTIVO'}
          className={inputCls}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m.charAt(0) + m.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-3">
        <label className={labelCls}>Concepto / nota</label>
        <input
          name="note"
          defaultValue={initial?.note ?? ''}
          placeholder="Consulta general — Max…"
          className={inputCls}
        />
        {!editing && (
          <p className="mt-1 text-[11px] text-fg-faint">
            Los pagos de una factura se registran desde la factura (acá van ingresos sueltos).
          </p>
        )}
      </div>

      {error && (
        <p className="sm:col-span-3 flex items-start gap-2 rounded-lg border border-warn bg-surface px-3 py-2 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <div className="sm:col-span-3 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
        >
          {isPending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar ingreso'}
        </button>
        <button
          type="button"
          onClick={close}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:bg-surface-2 transition"
        >
          <X className="size-4" aria-hidden />
          Cancelar
        </button>
      </div>
    </form>
  );
}

'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { registerExpenseAction } from '@/lib/facturacion/expenses/actions';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from '@/lib/facturacion/domain/finance';
import type { SupplierRow } from '@/lib/supabase/types';

const METHODS = ['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'OTRO'] as const;

const inputCls =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-brand focus:outline-none';
const labelCls = 'block text-xs font-medium text-fg-muted';

export interface ExpenseInitial {
  id: string;
  category: string;
  amountPesos: number;
  expenseDate: string;
  method: string;
  supplierId: string | null;
  note: string | null;
  hasAttachment: boolean;
}

/** Alta/edición de gasto manual con comprobante opcional. */
export function ExpenseForm({
  suppliers,
  today,
  initial,
  closeHref,
}: {
  suppliers: SupplierRow[];
  /** `YYYY-MM-DD` en Bogotá, calculado en el server para evitar hidration drift. */
  today: string;
  /** Si viene, el form abre en modo edición. */
  initial?: ExpenseInitial | null;
  /** URL para salir del modo edición (limpia el searchParam). */
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
      const r = await registerExpenseAction(fd);
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
        className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition"
      >
        <Plus className="size-4" aria-hidden />
        Registrar gasto
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
          <p className="sm:col-span-3 text-sm font-medium text-fg">Editar gasto</p>
        </>
      )}
      <div>
        <label className={labelCls}>Categoría</label>
        <select
          name="category"
          required
          className={inputCls}
          defaultValue={initial?.category ?? 'OTRO'}
        >
          {EXPENSE_CATEGORIES.filter((c) => c !== 'COMPRA_INVENTARIO').map((c) => (
            <option key={c} value={c}>
              {EXPENSE_CATEGORY_LABELS[c as ExpenseCategory]}
            </option>
          ))}
        </select>
        {!editing && (
          <p className="mt-1 text-[11px] text-fg-faint">
            Las compras de inventario se registran desde Compras.
          </p>
        )}
      </div>
      <div>
        <label className={labelCls}>Monto (COP)</label>
        <input
          name="amountPesos"
          type="number"
          min={1}
          step="any"
          required
          defaultValue={initial?.amountPesos}
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>Fecha</label>
        <input
          name="expenseDate"
          type="date"
          required
          defaultValue={initial?.expenseDate ?? today}
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>Método de pago</label>
        <select
          name="method"
          required
          defaultValue={initial?.method ?? 'TRANSFERENCIA'}
          className={inputCls}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m.charAt(0) + m.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>Proveedor (opcional)</label>
        <select name="supplierId" defaultValue={initial?.supplierId ?? ''} className={inputCls}>
          <option value="">— ninguno —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>
          Comprobante (PDF/JPG/PNG{editing && initial?.hasAttachment ? ' — reemplaza el actual' : ''}, opcional)
        </label>
        <input
          name="attachment"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className={`${inputCls} file:mr-2 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-xs file:text-fg-muted`}
        />
      </div>
      <div className="sm:col-span-3">
        <label className={labelCls}>Nota (opcional)</label>
        <input
          name="note"
          defaultValue={initial?.note ?? ''}
          placeholder="Arriendo julio, recibo de la luz…"
          className={inputCls}
        />
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
          {isPending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar gasto'}
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

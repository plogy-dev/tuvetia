'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Check, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import {
  setSupplierActiveAction,
  upsertSupplierAction,
} from '@/lib/facturacion/suppliers/actions';
import type { SupplierRow } from '@/lib/supabase/types';

type Draft = {
  id: string | null;
  name: string;
  nit: string;
  phone: string;
  email: string;
  notes: string;
};

const EMPTY: Draft = { id: null, name: '', nit: '', phone: '', email: '', notes: '' };

/**
 * Gestor de proveedores: crear, editar y activar/desactivar. No se borran
 * (las compras y el catálogo los referencian); se desactivan.
 */
export function SupplierManager({ suppliers }: { suppliers: SupplierRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const visible = showInactive ? suppliers : suppliers.filter((s) => s.active);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? 'Error');
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function save() {
    if (!draft || !draft.name.trim()) return;
    run(
      () =>
        upsertSupplierAction({
          id: draft.id,
          name: draft.name.trim(),
          nit: draft.nit.trim() || null,
          phone: draft.phone.trim() || null,
          email: draft.email.trim() || null,
          notes: draft.notes.trim() || null,
        }),
      () => setDraft(null),
    );
  }

  const inputCls =
    'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-3.5 accent-[var(--accent)]"
          />
          Mostrar inactivos
        </label>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setDraft({ ...EMPTY })}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
        >
          <Plus className="size-4" aria-hidden />
          Nuevo proveedor
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-warn bg-surface-2 px-3 py-2 text-sm text-warn">{error}</p>
      )}

      {draft && (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-fg-muted">
              Nombre *
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Distribuidora VetPlus"
                className={`${inputCls} w-full`}
              />
            </label>
            <label className="space-y-1 text-xs text-fg-muted">
              NIT
              <input
                value={draft.nit}
                onChange={(e) => setDraft({ ...draft, nit: e.target.value })}
                placeholder="900.123.456-7"
                className={`${inputCls} w-full`}
              />
            </label>
            <label className="space-y-1 text-xs text-fg-muted">
              Teléfono
              <input
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="300 123 4567"
                className={`${inputCls} w-full`}
              />
            </label>
            <label className="space-y-1 text-xs text-fg-muted">
              Email
              <input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="pedidos@vetplus.co"
                className={`${inputCls} w-full`}
              />
            </label>
          </div>
          <label className="block space-y-1 text-xs text-fg-muted">
            Notas
            <input
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Entrega martes y jueves; pedido mínimo $200.000…"
              className={`${inputCls} w-full`}
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPending || !draft.name.trim()}
              onClick={save}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
            >
              <Check className="size-4" aria-hidden />
              {draft.id ? 'Guardar cambios' : 'Crear proveedor'}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:text-fg transition"
            >
              <X className="size-4" aria-hidden />
              Cancelar
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {visible.length === 0 ? (
          <li className="px-4 py-6 text-sm text-fg-faint">
            Sin proveedores todavía. Créalos acá o quedarán registrados al importar
            inventario con columna «Proveedor».
          </li>
        ) : (
          visible.map((s) => (
            <li
              key={s.id}
              className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${s.active ? '' : 'opacity-50'}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">
                  {s.name}
                  {!s.active && (
                    <span className="ml-2 text-[10px] uppercase text-fg-faint">inactivo</span>
                  )}
                </p>
                <p className="truncate text-xs text-fg-faint">
                  {[s.nit && `NIT ${s.nit}`, s.phone, s.email].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {s.active && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        id: s.id,
                        name: s.name,
                        nit: s.nit ?? '',
                        phone: s.phone ?? '',
                        email: s.email ?? '',
                        notes: s.notes ?? '',
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg-muted hover:text-fg transition"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    Editar
                  </button>
                )}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => setSupplierActiveAction({ id: s.id, active: !s.active }))}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 transition disabled:opacity-60"
                >
                  {s.active ? (
                    <>
                      <Archive className="size-3.5" aria-hidden />
                      Desactivar
                    </>
                  ) : (
                    <>
                      <RotateCcw className="size-3.5" aria-hidden />
                      Reactivar
                    </>
                  )}
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Check, Archive, RotateCcw, ChevronUp, ChevronDown, Pencil } from 'lucide-react';
import {
  reorderCategoriesAction,
  setCategoryArchivedAction,
  upsertCategoryAction,
} from '@/lib/facturacion/actions';
import type { CatalogCategoryRow } from '@/lib/supabase/types';

/**
 * Gestor de categorías: crear, renombrar, archivar/reactivar y reordenar. La
 * categoría por defecto («Sin categoría») no se renombra ni archiva. Al archivar
 * una categoría, sus ítems quedan sin categoría.
 */
export function CategoryManager({ categories }: { categories: CatalogCategoryRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const visible = (showArchived ? categories : categories.filter((c) => !c.archived_at)).filter(
    (c) => !c.is_default,
  );
  // El orden reordenable excluye la default.
  const orderable = categories.filter((c) => !c.is_default && !c.archived_at);

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

  function create() {
    if (!newName.trim()) return;
    run(() => upsertCategoryAction({ name: newName.trim() }), () => setNewName(''));
  }
  function rename(id: string) {
    if (!editName.trim()) return;
    run(() => upsertCategoryAction({ id, name: editName.trim() }), () => setEditId(null));
  }
  function move(index: number, dir: -1 | 1) {
    const ids = orderable.map((c) => c.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    run(() => reorderCategoriesAction({ orderedIds: ids }));
  }

  const inputCls =
    'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-brand focus:outline-none';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="size-3.5 accent-[var(--accent)]"
          />
          Mostrar archivadas
        </label>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Nueva categoría…"
            className={inputCls}
          />
          <button
            type="button"
            disabled={isPending || !newName.trim()}
            onClick={create}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
          >
            <Plus className="size-4" aria-hidden />
            Crear
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-warn bg-surface-2 px-3 py-2 text-sm text-warn">{error}</p>
      )}

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {visible.length === 0 ? (
          <li className="px-4 py-6 text-sm text-fg-faint">Sin categorías propias todavía.</li>
        ) : (
          visible.map((c) => {
            const orderIndex = orderable.findIndex((o) => o.id === c.id);
            return (
              <li key={c.id} className={`flex items-center gap-2 px-4 py-2.5 ${c.archived_at ? 'opacity-50' : ''}`}>
                {!c.archived_at && (
                  <div className="flex flex-col">
                    <button
                      type="button"
                      disabled={isPending || orderIndex <= 0}
                      onClick={() => move(orderIndex, -1)}
                      className="text-fg-faint hover:text-fg disabled:opacity-30"
                      aria-label="Subir"
                    >
                      <ChevronUp className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={isPending || orderIndex >= orderable.length - 1}
                      onClick={() => move(orderIndex, 1)}
                      className="text-fg-faint hover:text-fg disabled:opacity-30"
                      aria-label="Bajar"
                    >
                      <ChevronDown className="size-3.5" aria-hidden />
                    </button>
                  </div>
                )}

                {editId === c.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(c.id);
                      if (e.key === 'Escape') setEditId(null);
                    }}
                    className={`${inputCls} flex-1`}
                  />
                ) : (
                  <span className="flex-1 text-sm text-fg">
                    {c.name}
                    {c.archived_at && <span className="ml-2 text-[10px] uppercase text-fg-faint">archivada</span>}
                  </span>
                )}

                <div className="flex items-center gap-1">
                  {editId === c.id ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => rename(c.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg-muted hover:text-ok transition"
                    >
                      <Check className="size-3.5" aria-hidden />
                      Guardar
                    </button>
                  ) : (
                    !c.archived_at && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditId(c.id);
                          setEditName(c.name);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg-muted hover:text-fg transition"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        Renombrar
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => setCategoryArchivedAction({ id: c.id, archived: !c.archived_at }))}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 transition disabled:opacity-60"
                  >
                    {c.archived_at ? (
                      <>
                        <RotateCcw className="size-3.5" aria-hidden />
                        Reactivar
                      </>
                    ) : (
                      <>
                        <Archive className="size-3.5" aria-hidden />
                        Archivar
                      </>
                    )}
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>
      <p className="text-[11px] text-fg-faint">
        Al archivar una categoría, sus ítems quedan «Sin categoría». La categoría por defecto no se
        edita ni archiva.
      </p>
    </div>
  );
}

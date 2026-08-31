'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Archive, RotateCcw, FlaskConical } from 'lucide-react';
import {
  setCatalogItemActiveAction,
  setCatalogItemCategoryAction,
} from '@/lib/facturacion/actions';
import { formatCOP } from '@/lib/facturacion/format';
import type { CatalogCategoryRow, CatalogItemRow, SupplierRow } from '@/lib/supabase/types';
import { TD, TD_NUM, TH, TH_DER } from './densidad';
import { CatalogItemForm } from './CatalogItemForm';
import { RecipeEditor, type RecipeComponentOption } from './RecipeEditor';
import { toast } from "sonner"

/**
 * Pestaña editable de ítems (productos o servicios). Alta/edición con formulario,
 * asignación rápida de categoría, archivar/reactivar. Archivar = active=false;
 * el carrito solo ofrece activos y las líneas históricas quedan intactas.
 */
/** Los tipos, escritos como se leen. La columna «Tipo» los muestra tal cual en OkVet. */
const ETIQUETA_DE_TIPO: Record<string, string> = {
  SERVICIO: 'Servicio',
  PRODUCTO: 'Producto',
  MEDICAMENTO: 'Medicamento',
  INSUMO: 'Insumo',
}

export function CatalogItemsTab({
  items,
  categories,
  defaultType,
  recipeComponents,
  suppliers,
}: {
  items: CatalogItemRow[];
  categories: CatalogCategoryRow[];
  defaultType: CatalogItemRow['item_type'];
  /** Componentes disponibles para recetas (solo en la pestaña Servicios). */
  recipeComponents?: RecipeComponentOption[];
  /** Proveedores activos (0029) para el selector del formulario. */
  suppliers?: SupplierRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipesEnabled = !!recipeComponents;

  const visible = showArchived ? items : items.filter((i) => i.active);
  const catName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? 'Sin categoría';

  function setCategory(id: string, categoryId: string) {
    startTransition(async () => {
      // La guarda que devuelve los botones (28-ago): si esta promesa RECHAZA —sesión vencida,
      // red caída, o un id de Server Action viejo tras un deploy— React nunca cierra la
      // transición e `isPending` deja los botones deshabilitados hasta recargar.
      try {
        const r = await setCatalogItemCategoryAction({ id, categoryId: categoryId || null });
        // Sin esto, un fallo era invisible: el refresh revertía el <select> sin decir por qué.
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setError(null);
        router.refresh();
    
      } catch (e) {
        toast.error(`No se pudo completar la acción: ${(e as Error)?.message ?? e}`)
      }
    });
  }
  function toggleActive(id: string, active: boolean) {
    startTransition(async () => {
      // La guarda que devuelve los botones (28-ago): si esta promesa RECHAZA —sesión vencida,
      // red caída, o un id de Server Action viejo tras un deploy— React nunca cierra la
      // transición e `isPending` deja los botones deshabilitados hasta recargar.
      try {
        const r = await setCatalogItemActiveAction({ id, active });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setError(null);
        router.refresh();
    
      } catch (e) {
        toast.error(`No se pudo completar la acción: ${(e as Error)?.message ?? e}`)
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-warn bg-surface-2 px-3 py-2 text-xs text-warn">{error}</p>
      )}
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="size-3.5 accent-[var(--accent)]"
          />
          Mostrar archivados
        </label>
        <button
          type="button"
          onClick={() => {
            setCreating((v) => !v);
            setEditId(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition"
        >
          <Plus className="size-4" aria-hidden />
          Nuevo
        </button>
      </div>

      {creating && (
        <CatalogItemForm
          categories={categories}
          suppliers={suppliers}
          defaultType={defaultType}
          onDone={() => setCreating(false)}
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        {visible.length === 0 ? (
          <p className="px-5 py-8 text-sm text-fg-faint">Sin ítems todavía.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
{/* LAS COLUMNAS Y SU ORDEN SON LOS DE OKVET, mirados con la cuenta del cliente el
                  24-ago: Opciones · Ref. · Grupo · Categoría · Nombre · Tipo · Inv. · Disponibles ·
                  Pick. · P.V. · Impuestos · Creado.

                  No están «Inv.», «Disponibles», «Pick.» ni «Creado»: las existencias viven en su
                  propia pantalla y meterlas acá duplicaría el dato con el riesgo de que digan cosas
                  distintas. «P.V.» es su etiqueta para el precio de venta — se conserva con su
                  título completo encima, porque abreviada sola no la entiende quien nunca usó
                  OkVet. */}
              <tr className="border-b border-line text-left">
                <th className={TH}>Opciones</th>
                <th className={TH}>Ref.</th>
                <th className={TH}>Grupo</th>
                <th className={TH}>Categoría</th>
                <th className={TH}>Nombre</th>
                <th className={TH}>Tipo</th>
                <th className={TH_DER} title="Precio de venta">
                  P.V.
                </th>
                <th className={TH}>Impuestos</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => (
                <Fragment key={i.id}>
                  <tr
                    className={`border-b border-line/60 last:border-0 ${i.active ? '' : 'opacity-50'}`}
                  >
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-1">
                          {recipesEnabled && i.item_type === 'SERVICIO' && (
                            <button
                              type="button"
                              onClick={() => {
                                setRecipeId(recipeId === i.id ? null : i.id);
                                setEditId(null);
                                setCreating(false);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg transition"
                            >
                              <FlaskConical className="size-3.5" aria-hidden />
                              Receta
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setEditId(editId === i.id ? null : i.id);
                              setCreating(false);
                              setRecipeId(null);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg transition"
                          >
                            <Pencil className="size-3.5" aria-hidden />
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => toggleActive(i.id, !i.active)}
                            className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 transition disabled:opacity-60"
                            title={catName(i.category_id)}
                          >
                            {i.active ? (
                              <>
                                <Archive className="size-3.5" aria-hidden />
                                Archivar
                              </>
                            ) : (
                              <>
                                <RotateCcw className="size-3.5" aria-hidden />
                                Reactivar
                              </>
                            )}
                          </button>
                        </div>
                    </td>
                    <td className={`${TD} font-mono tabular-nums text-fg-muted`}>
                      {i.sku || '—'}
                    </td>
                    <td className={`${TD} text-fg-muted`}>{i.item_group || '—'}</td>
                    <td className={TD}>
                      <select
                        value={i.category_id ?? ''}
                        onChange={(e) => setCategory(i.id, e.target.value)}
                        disabled={isPending}
                        className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg-muted outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        aria-label={`Categoría de ${i.name}`}
                      >
                        <option value="">Sin categoría</option>
                        {categories
                          .filter((c) => !c.is_default)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className={`${TD} font-medium text-fg`}>
                      {i.name}
                      {!i.active && <span className="ml-2 text-[10px] uppercase text-fg-faint">archivado</span>}
                    </td>
                    <td className={`${TD} text-fg-muted`}>{ETIQUETA_DE_TIPO[i.item_type] ?? i.item_type}</td>
                    <td className={`${TD_NUM} text-fg`}>{formatCOP(i.price_cents)}</td>
                    <td className={`${TD} text-fg-muted`}>
                      {i.tax_status === 'GRAVADO' ? `${i.tax_rate}%` : i.tax_status === 'EXENTO' ? 'Exento' : 'Excluido'}
                    </td>
                  </tr>
                  {editId === i.id && (
                    <tr>
                      <td colSpan={5} className="px-5 py-3">
                        <CatalogItemForm
                          categories={categories}
                          suppliers={suppliers}
                          initial={i}
                          onDone={() => setEditId(null)}
                        />
                      </td>
                    </tr>
                  )}
                  {recipesEnabled && recipeId === i.id && (
                    <tr>
                      <td colSpan={5} className="px-5 py-3">
                        <RecipeEditor serviceId={i.id} components={recipeComponents!} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

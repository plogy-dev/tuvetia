'use client';

import { useState, useTransition } from 'react';
import { InputPesos } from '@/components/facturacion/InputPesos';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { upsertCatalogItem, type UpsertCatalogItemInput } from '@/lib/facturacion/actions';
import type { CatalogCategoryRow, CatalogItemRow, SupplierRow } from '@/lib/supabase/types';

const inputCls =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
const labelCls = 'block text-xs font-medium text-fg-muted';

/** Formulario de creación/edición de un ítem del catálogo. */
export function CatalogItemForm({
  categories,
  suppliers,
  initial,
  defaultType,
  onDone,
}: {
  categories: CatalogCategoryRow[];
  /** Proveedores activos (0029); si no llegan, el campo no se muestra. */
  suppliers?: SupplierRow[];
  initial?: CatalogItemRow | null;
  defaultType?: CatalogItemRow['item_type'];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<CatalogItemRow['item_type']>(
    initial?.item_type ?? defaultType ?? 'PRODUCTO',
  );
  const isService = type === 'SERVICIO';
  const isMed = type === 'MEDICAMENTO';

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const taxStatus = fd.get('taxStatus') as 'GRAVADO' | 'EXENTO' | 'EXCLUIDO';
    const num = (k: string) => {
      const v = fd.get(k);
      return v === null || v === '' ? null : Number(v);
    };
    const str = (k: string) => {
      const v = (fd.get(k) as string | null)?.trim();
      return v ? v : null;
    };
    const input: UpsertCatalogItemInput = {
      id: initial?.id ?? null,
      itemType: type,
      name: String(fd.get('name') ?? ''),
      sku: str('sku'),
      itemGroup: str('itemGroup'),
      categoryId: str('categoryId') as string | null,
      priceCents: Math.round((num('pricePesos') ?? 0) * 100),
      costCents: num('costPesos') === null ? null : Math.round((num('costPesos') as number) * 100),
      taxStatus,
      taxRate: taxStatus === 'GRAVADO' ? (num('taxRate') ?? 19) : 0,
      trackStock: !isService && fd.get('trackStock') === 'on',
      useUnit: String(fd.get('useUnit') || 'unidad'),
      purchaseUnit: String(fd.get('purchaseUnit') || fd.get('useUnit') || 'unidad'),
      conversionFactor: num('conversionFactor') ?? 1,
      minStock: num('minStock'),
      supplierId: isService ? null : (str('supplierId') as string | null),
      // El texto legado solo se conserva si el ítem no queda ligado a un proveedor real.
      supplier: isService || str('supplierId') ? null : (initial?.supplier ?? null),
      durationMinutes: isService ? num('durationMinutes') : null,
      barcode: str('barcode'),
      activeIngredient: isMed ? str('activeIngredient') : null,
      concentration: isMed ? str('concentration') : null,
      presentation: str('presentation'),
      manufacturer: str('manufacturer'),
      active: initial?.active ?? true,
    };
    startTransition(async () => {
      const r = await upsertCatalogItem(input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
      onDone?.();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line bg-surface-2 p-4 sm:grid-cols-2">
      <div>
        <label className={labelCls}>Tipo</label>
        <select
          name="itemType"
          value={type}
          onChange={(e) => setType(e.target.value as CatalogItemRow['item_type'])}
          className={inputCls}
        >
          <option value="SERVICIO">Servicio</option>
          <option value="PRODUCTO">Producto</option>
          <option value="MEDICAMENTO">Medicamento</option>
          <option value="INSUMO">Insumo</option>
        </select>
      </div>
      <div>
        <label className={labelCls}>Nombre</label>
        <input name="name" required defaultValue={initial?.name} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Categoría</label>
        <select name="categoryId" defaultValue={initial?.category_id ?? ''} className={inputCls}>
          <option value="">Sin categoría</option>
          {categories
            .filter((c) => !c.is_default)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>
      <div>
        {/* «Ref.» es como lo llama OkVet en su inventario; se conserva «SKU» al lado porque es lo
            que dice cualquier planilla de proveedor. */}
        <label className={labelCls}>Ref. / SKU (opcional)</label>
        <input name="sku" defaultValue={initial?.sku ?? ''} className={inputCls} />
      </div>
      <div>
        {/* «Grupo» es OTRO eje que «Categoría», no su padre: en OkVet las categorías se gestionan
            en su propia pantalla y no tienen grupo encima. Va como texto libre. */}
        <label className={labelCls}>Grupo (opcional)</label>
        <input
          name="itemGroup"
          defaultValue={initial?.item_group ?? ''}
          maxLength={80}
          placeholder="Ej.: Medicamentos, Peluquería, Alimento"
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>Precio de venta (COP)</label>
        {/* Con separador de miles mientras se teclea (David, 26-ago): en el campo donde un cero
            de más es diez veces el precio, «80.000» se lee y «80000» se cuenta con el dedo. */}
        <InputPesos
          name="pricePesos"
          required
          defaultValue={initial ? initial.price_cents / 100 : undefined}
          className={inputCls}
          aria-label="Precio de venta en pesos"
        />
      </div>
      <div>
        <label className={labelCls}>Costo (COP, opcional)</label>
        <InputPesos
          name="costPesos"
          defaultValue={initial?.cost_cents != null ? initial.cost_cents / 100 : undefined}
          className={inputCls}
          aria-label="Costo en pesos"
        />
      </div>
      <div>
        <label className={labelCls}>Condición de IVA</label>
        <div className="mt-1 flex gap-2">
          <select name="taxStatus" defaultValue={initial?.tax_status ?? 'GRAVADO'} className={inputCls.replace('mt-1 ', '')}>
            <option value="GRAVADO">Gravado</option>
            <option value="EXENTO">Exento (0%)</option>
            <option value="EXCLUIDO">Excluido</option>
          </select>
          <select name="taxRate" defaultValue={String(initial?.tax_rate ?? 19)} className={inputCls.replace('mt-1 ', '')}>
            <option value="19">19%</option>
            <option value="5">5%</option>
            <option value="0">0%</option>
          </select>
        </div>
      </div>

      {isService ? (
        <div>
          <label className={labelCls}>Duración (min, opcional)</label>
          <input
            name="durationMinutes"
            type="number"
            min={0}
            step={5}
            defaultValue={initial?.duration_minutes ?? undefined}
            className={inputCls}
          />
        </div>
      ) : (
        <div className="sm:col-span-2 grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm text-fg sm:col-span-3">
            <input
              type="checkbox"
              name="trackStock"
              defaultChecked={initial?.track_stock ?? true}
              className="size-4 accent-[var(--accent)]"
            />
            Controlar existencias
          </label>
          <div>
            <label className={labelCls}>Unidad de uso/venta</label>
            <input name="useUnit" defaultValue={initial?.use_unit ?? 'unidad'} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Unidad de compra</label>
            <input name="purchaseUnit" defaultValue={initial?.purchase_unit ?? 'unidad'} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Factor (uso por compra)</label>
            <input
              name="conversionFactor"
              type="number"
              min={0.0001}
              step="0.0001"
              defaultValue={initial?.conversion_factor ?? 1}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Stock mínimo</label>
            <input
              name="minStock"
              type="number"
              min={0}
              step={1}
              defaultValue={initial?.min_stock ?? undefined}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Código de barras</label>
            <input name="barcode" defaultValue={initial?.barcode ?? ''} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Presentación</label>
            <input name="presentation" defaultValue={initial?.presentation ?? ''} className={inputCls} />
          </div>
          {suppliers && (
            <div>
              <label className={labelCls}>Proveedor</label>
              <select
                name="supplierId"
                defaultValue={initial?.supplier_id ?? ''}
                className={inputCls}
              >
                <option value="">— sin proveedor —</option>
                {suppliers
                  .filter((s) => s.active || s.id === initial?.supplier_id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              {initial?.supplier && !initial?.supplier_id && (
                <p className="mt-1 text-[11px] text-fg-faint">
                  Antes: «{initial.supplier}» (texto libre)
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {isMed && (
        <div className="sm:col-span-2 grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Principio activo</label>
            <input name="activeIngredient" defaultValue={initial?.active_ingredient ?? ''} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Concentración</label>
            <input name="concentration" defaultValue={initial?.concentration ?? ''} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Fabricante</label>
            <input name="manufacturer" defaultValue={initial?.manufacturer ?? ''} className={inputCls} />
          </div>
        </div>
      )}

      {error && (
        <p className="sm:col-span-2 flex items-start gap-2 rounded-lg border border-warn bg-surface px-3 py-2 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <div className="sm:col-span-2 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
        >
          {isPending ? 'Guardando…' : initial ? 'Guardar cambios' : 'Crear ítem'}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:bg-surface-2 transition"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

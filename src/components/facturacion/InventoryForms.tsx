'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, PackagePlus, ArrowDownUp } from 'lucide-react';
import {
  registerInventoryMovement,
  upsertCatalogItem,
  type UpsertCatalogItemInput,
} from '@/lib/facturacion/actions';
import type { CatalogItemRow } from '@/lib/supabase/types';

/** Formularios de inventario: crear ítem del catálogo + movimiento manual. */
export function InventoryForms({ items }: { items: CatalogItemRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<'item' | 'movement' | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  function runItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    const taxStatus = fd.get('taxStatus') as 'GRAVADO' | 'EXENTO' | 'EXCLUIDO';
    const input: UpsertCatalogItemInput = {
      itemType: fd.get('itemType') as UpsertCatalogItemInput['itemType'],
      name: String(fd.get('name') ?? ''),
      priceCents: Math.round(Number(fd.get('pricePesos') ?? 0) * 100),
      taxRate: taxStatus === 'GRAVADO' ? Number(fd.get('taxRate') ?? 19) : 0,
      taxStatus,
      trackStock: fd.get('trackStock') === 'on',
      useUnit: String(fd.get('useUnit') || 'unidad'),
      purchaseUnit: String(fd.get('useUnit') || 'unidad'),
      minStock: fd.get('minStock') ? Number(fd.get('minStock')) : null,
    };
    startTransition(async () => {
      const r = await upsertCatalogItem(input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOkMsg(`«${r.item.name}» creado.`);
      form.reset();
      router.refresh();
    });
  }

  function runMovement(e: React.FormEvent<HTMLFormElement>) {
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
    // Entradas positivas, salidas negativas; AJUSTE respeta el signo digitado.
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
    'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-brand focus:outline-none';
  const labelCls = 'block text-xs font-medium text-fg-muted';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(open === 'item' ? null : 'item')}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
            open === 'item'
              ? 'border-brand bg-brand text-on-brand'
              : 'border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <PackagePlus className="size-4" aria-hidden />
          Nuevo servicio/producto
        </button>
        <button
          type="button"
          onClick={() => setOpen(open === 'movement' ? null : 'movement')}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
            open === 'movement'
              ? 'border-brand bg-brand text-on-brand'
              : 'border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          <ArrowDownUp className="size-4" aria-hidden />
          Registrar movimiento
        </button>
      </div>

      {open === 'item' && (
        <form onSubmit={runItem} className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Tipo</label>
            <select name="itemType" className={inputCls} defaultValue="SERVICIO">
              <option value="SERVICIO">Servicio</option>
              <option value="PRODUCTO">Producto</option>
              <option value="MEDICAMENTO">Medicamento</option>
              <option value="INSUMO">Insumo</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Nombre</label>
            <input name="name" required placeholder="Consulta general" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Precio (COP)</label>
            <input name="pricePesos" type="number" min={0} step={100} required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Condición de IVA</label>
            <div className="mt-1 flex gap-2">
              <select name="taxStatus" className={inputCls.replace('mt-1 ', '')} defaultValue="GRAVADO">
                <option value="GRAVADO">Gravado</option>
                <option value="EXENTO">Exento (0%)</option>
                <option value="EXCLUIDO">Excluido</option>
              </select>
              <select name="taxRate" className={inputCls.replace('mt-1 ', '')} defaultValue="19">
                <option value="19">19%</option>
                <option value="5">5%</option>
                <option value="0">0%</option>
              </select>
            </div>
            <p className="mt-1 text-[11px] text-fg-faint">
              Servicios vet: 19% · medicamentos: usualmente excluidos — confírmalo con tu contador.
            </p>
          </div>
          <div>
            <label className={labelCls}>Unidad de uso/venta</label>
            <input name="useUnit" placeholder="unidad / ml / tableta" className={inputCls} />
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" name="trackStock" className="size-4 accent-[var(--accent)]" />
              Controlar existencias
            </label>
            <div className="flex-1">
              <label className={labelCls}>Stock mínimo</label>
              <input name="minStock" type="number" min={0} step={1} className={inputCls} />
            </div>
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
            >
              {isPending ? 'Guardando…' : 'Crear ítem'}
            </button>
          </div>
        </form>
      )}

      {open === 'movement' && (
        <form onSubmit={runMovement} className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Ítem</label>
            <select name="itemId" required className={inputCls}>
              <option value="">Selecciona…</option>
              {items
                .filter((i) => i.track_stock)
                .map((i) => (
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

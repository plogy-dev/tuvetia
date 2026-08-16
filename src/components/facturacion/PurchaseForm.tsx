'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { confirmPurchaseAction, savePurchaseDraft } from '@/lib/facturacion/purchases/actions';
import { formatCOP } from '@/lib/facturacion/domain/money';
import type { SupplierRow } from '@/lib/supabase/types';

export interface PurchaseItemOption {
  id: string;
  name: string;
  purchase_unit: string;
  use_unit: string;
  conversion_factor: number;
  cost_cents: number | null;
}

interface LineDraft {
  key: number;
  catalogItemId: string;
  qty: string;
  costPesos: string;
  lotCode: string;
  expiresOn: string;
}

export interface PurchaseInitial {
  id: string;
  supplierId: string | null;
  purchasedOn: string;
  docNumber: string | null;
  method: string | null;
  note: string | null;
  lines: {
    catalogItemId: string;
    qty: number;
    unitCostCents: number;
    lotCode: string | null;
    expiresOn: string | null;
  }[];
}

const METHODS = ['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'OTRO'] as const;

const inputCls =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-brand focus:outline-none';
const labelCls = 'block text-xs font-medium text-fg-muted';

/**
 * Registro de una compra a proveedor: cabecera + líneas con ítems del catálogo.
 * qty va en unidad de COMPRA del ítem (con hint del factor). El total en vivo
 * es informativo; el server lo recalcula al guardar.
 */
export function PurchaseForm({
  suppliers,
  items,
  today,
  initial,
}: {
  suppliers: SupplierRow[];
  items: PurchaseItemOption[];
  /** `YYYY-MM-DD` Bogotá, calculado en el server. */
  today: string;
  /** Si viene, edita ese borrador en vez de crear uno nuevo. */
  initial?: PurchaseInitial | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const savedIdRef = useRef<string | null>(initial?.id ?? null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? '');
  const [purchasedOn, setPurchasedOn] = useState(initial?.purchasedOn ?? today);
  const [docNumber, setDocNumber] = useState(initial?.docNumber ?? '');
  const [method, setMethod] = useState(initial?.method ?? 'TRANSFERENCIA');
  const [note, setNote] = useState(initial?.note ?? '');
  const [lines, setLines] = useState<LineDraft[]>(
    initial && initial.lines.length > 0
      ? initial.lines.map((l, i) => ({
          key: i,
          catalogItemId: l.catalogItemId,
          qty: String(l.qty),
          // División exacta: redondear a pesos truncaba los centavos del costo, y reabrir un
          // borrador para editarlo cambiaba el importe sin que nadie tocara el campo.
          costPesos: String(l.unitCostCents / 100),
          lotCode: l.lotCode ?? '',
          expiresOn: l.expiresOn ?? '',
        }))
      : [{ key: 0, catalogItemId: '', qty: '1', costPesos: '', lotCode: '', expiresOn: '' }],
  );

  const itemById = new Map(items.map((i) => [i.id, i]));

  function setLine(key: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [
      ...ls,
      { key: Math.max(0, ...ls.map((l) => l.key)) + 1, catalogItemId: '', qty: '1', costPesos: '', lotCode: '', expiresOn: '' },
    ]);
  }
  function removeLine(key: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  }

  function pickItem(key: number, id: string) {
    const item = itemById.get(id);
    setLine(key, {
      catalogItemId: id,
      // Precarga el costo de compra estimado: último costo de uso × factor.
      costPesos:
        item?.cost_cents != null
          ? // Redondeo al centavo (no al peso): es un estimado, pero no hay razón para tirar
            // la precisión que el costo guardado sí tiene.
            String(Math.round(item.cost_cents * (item.conversion_factor || 1)) / 100)
          : '',
    });
  }

  const totalCents = lines.reduce((sum, l) => {
    const qty = Number(l.qty);
    const cost = Number(l.costPesos);
    if (!Number.isFinite(qty) || !Number.isFinite(cost) || qty <= 0 || cost < 0) return sum;
    return sum + Math.round(qty * Math.round(cost * 100));
  }, 0);

  function buildInput() {
    return {
      id: initial?.id ?? null,
      supplierId: supplierId || null,
      purchasedOn,
      docNumber: docNumber || null,
      method: (method || null) as (typeof METHODS)[number] | null,
      note: note || null,
      lines: lines
        .filter((l) => l.catalogItemId)
        .map((l) => ({
          catalogItemId: l.catalogItemId,
          qty: Number(l.qty),
          unitCostCents: Math.round(Number(l.costPesos || 0) * 100),
          lotCode: l.lotCode || null,
          expiresOn: l.expiresOn || null,
        })),
    };
  }

  function save(confirmAfter: boolean) {
    setError(null);
    // El id del borrador ya guardado viaja en el input: savePurchaseDraft upserta, así que un
    // reintento (p. ej. tras fallar la confirmación) actualiza el MISMO borrador en vez de crear
    // uno nuevo por cada clic.
    const input = { ...buildInput(), id: savedIdRef.current };
    if (input.lines.length === 0) {
      setError('Agrega al menos una línea con producto');
      return;
    }
    startTransition(async () => {
      const r = await savePurchaseDraft(input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      savedIdRef.current = r.id;
      if (confirmAfter) {
        const c = await confirmPurchaseAction({ id: r.id });
        if (!c.ok) {
          // Sin router.push: navegar en el mismo tick desmontaba el componente y el error jamás
          // se pintaba — el usuario aterrizaba en un detalle "BORRADOR" sin explicación. Se queda
          // aquí, ve el motivo, y puede reintentar (mismo borrador) o abrirlo con el enlace.
          setSavedDraftId(r.id);
          setError(`La compra quedó guardada como borrador, pero no se pudo confirmar: ${c.error}`);
          return;
        }
      }
      router.push(`/dashboard/facturacion/compras/${r.id}`);
    });
  }

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={labelCls}>Proveedor</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${inputCls} mt-1`}>
            <option value="">— sin proveedor —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Fecha</label>
          <input type="date" value={purchasedOn} onChange={(e) => setPurchasedOn(e.target.value)} className={`${inputCls} mt-1`} />
        </div>
        <div>
          <label className={labelCls}>Nº factura del proveedor</label>
          <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="FV-1234" className={`${inputCls} mt-1`} />
        </div>
        <div>
          <label className={labelCls}>Método de pago</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${inputCls} mt-1`}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m.charAt(0) + m.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <label className={labelCls}>Nota (opcional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pedido quincenal…" className={`${inputCls} mt-1`} />
        </div>
      </div>

      {/* Líneas */}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-faint">
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-2 py-2 font-medium">Cantidad</th>
              <th className="px-2 py-2 font-medium">Costo unitario (COP)</th>
              <th className="px-2 py-2 font-medium">Lote</th>
              <th className="px-2 py-2 font-medium">Vence</th>
              <th className="px-2 py-2 text-right font-medium">Subtotal</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const item = l.catalogItemId ? itemById.get(l.catalogItemId) : null;
              const qty = Number(l.qty);
              const cost = Number(l.costPesos);
              const sub =
                Number.isFinite(qty) && Number.isFinite(cost) && qty > 0 && cost >= 0
                  ? Math.round(qty * Math.round(cost * 100))
                  : 0;
              return (
                <tr key={l.key} className="border-b border-line/60 align-top last:border-0">
                  <td className="min-w-52 px-4 py-2">
                    <select
                      value={l.catalogItemId}
                      onChange={(e) => pickItem(l.key, e.target.value)}
                      className={inputCls}
                    >
                      <option value="">— elegir producto —</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                    {item && item.conversion_factor !== 1 && (
                      <p className="mt-1 text-[11px] text-fg-faint">
                        1 {item.purchase_unit} = {item.conversion_factor} {item.use_unit}
                      </p>
                    )}
                  </td>
                  <td className="w-28 px-2 py-2">
                    <input
                      type="number"
                      min={0.0001}
                      step="any"
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      className={inputCls}
                    />
                    {item && (
                      <p className="mt-1 text-[11px] text-fg-faint">{item.purchase_unit}</p>
                    )}
                  </td>
                  <td className="w-36 px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={l.costPesos}
                      onChange={(e) => setLine(l.key, { costPesos: e.target.value })}
                      className={inputCls}
                    />
                    {item && <p className="mt-1 text-[11px] text-fg-faint">por {item.purchase_unit}</p>}
                  </td>
                  <td className="w-28 px-2 py-2">
                    <input
                      value={l.lotCode}
                      onChange={(e) => setLine(l.key, { lotCode: e.target.value })}
                      placeholder="—"
                      className={inputCls}
                    />
                  </td>
                  <td className="w-36 px-2 py-2">
                    <input
                      type="date"
                      value={l.expiresOn}
                      onChange={(e) => setLine(l.key, { expiresOn: e.target.value })}
                      className={inputCls}
                    />
                  </td>
                  <td className="px-2 py-3 text-right font-mono text-xs tabular-nums text-fg">
                    {formatCOP(sub)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeLine(l.key)}
                      disabled={lines.length === 1}
                      title="Quitar línea"
                      className="rounded-md p-1.5 text-fg-faint hover:text-warn transition disabled:opacity-30"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted hover:text-fg transition"
          >
            <Plus className="size-3.5" aria-hidden />
            Agregar línea
          </button>
          <p className="text-sm text-fg">
            Total: <span className="font-semibold tabular-nums">{formatCOP(totalCents)}</span>
          </p>
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-warn bg-surface-2 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {error}
            {savedDraftId && (
              <>
                {' '}
                <Link
                  href={`/dashboard/facturacion/compras/${savedDraftId}`}
                  className="font-medium underline underline-offset-2"
                >
                  Abrir el borrador
                </Link>
              </>
            )}
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => save(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
        >
          {isPending ? (
            <>
              <RefreshCw className="size-4 animate-spin" aria-hidden />
              Guardando…
            </>
          ) : (
            'Guardar y confirmar'
          )}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => save(false)}
          className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:bg-surface-2 transition disabled:opacity-60"
        >
          Guardar borrador
        </button>
        <span className="text-xs text-fg-faint">
          Confirmar suma el stock, actualiza costos y registra el egreso en Finanzas.
        </span>
      </div>
    </div>
  );
}

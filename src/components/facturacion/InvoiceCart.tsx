'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createInvoiceDraft,
  issueInvoiceAction,
  type CreateDraftInput,
} from '@/lib/facturacion/actions';
import { computeLineAmounts, computeInvoiceTotals, formatCOP } from '@/lib/facturacion/domain/money';
import { checkPosThreshold } from '@/lib/facturacion/domain/dian-rules';
import type { DocKind } from '@/lib/facturacion/domain/types';
import type { CatalogItemRow } from '@/lib/supabase/types';
import {
  makeDefaultPlan,
  PaymentSection,
  planToActionFields,
  validatePlan,
  type PaymentPlan,
} from './PaymentSection';

/**
 * Carrito de factura. Los totales se calculan EN VIVO con el mismo dominio puro
 * que usa el servidor (computeLineAmounts) — lo que ves es lo que se emite.
 * La validación fiscal completa (stock, datos del pagador) corre en el server
 * al guardar/emitir.
 */

type CartLine = {
  key: number;
  catalogItemId: string | null;
  description: string;
  qty: number;
  unitPriceCents: number;
  taxRate: number;
};

export function InvoiceCart({
  items,
  ownerId,
  ownerName,
  patientId,
  patientName,
  consultationId,
  renglonesIniciales,
  defaultDocKind,
  uvtValueCents,
  defaultTermsDays,
  reminderChannel,
  remindersEnabled,
}: {
  items: CatalogItemRow[];
  ownerId?: string;
  ownerName?: string;
  patientId?: string;
  patientName?: string;
  consultationId?: string;
  /**
   * Lo que se recetó en la consulta, ya cruzado con el catálogo (`lib/facturacion/lo-recetado`).
   *
   * ARRANCA EL CARRITO LLENO en vez de vacío. Antes, venir desde una consulta traía el paciente y
   * el titular pero ninguna línea: el vet tenía que releer el plan en otra pestaña y volver a
   * teclear lo que ya estaba escrito.
   *
   * TODO ENTRA EN CANTIDAD 1 — la posología no se convierte en unidades. Ver el módulo: si el
   * cálculo falla, falla en la factura de un cliente, y un número que ya viene puesto y parece
   * razonable no lo revisa nadie.
   */
  renglonesIniciales?: {
    descripcion: string;
    catalogItemId: string | null;
    unitPriceCents: number;
    taxRate: number;
  }[];
  defaultDocKind: DocKind;
  uvtValueCents: number;
  defaultTermsDays: number;
  reminderChannel: 'WHATSAPP' | 'EMAIL';
  remindersEnabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Borrador ya creado en este intento de emisión (para reintentar sin duplicar) y su URL,
  // que se ofrece como salida cuando la emisión falla.
  const draftRef = useRef<{ key: string; id: string; url: string; warnings: string[] } | null>(null);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lines, setLines] = useState<CartLine[]>(() =>
    (renglonesIniciales ?? []).map((r, i) => ({
      key: i,
      catalogItemId: r.catalogItemId,
      description: r.descripcion,
      qty: 1,
      unitPriceCents: r.unitPriceCents,
      taxRate: r.taxRate,
    })),
  );
  const [docKind, setDocKind] = useState<DocKind>(defaultDocKind);
  const [plan, setPlan] = useState<PaymentPlan>(() => makeDefaultPlan(defaultTermsDays));
  // Arranca DESPUÉS de las líneas sembradas, o la primera que se agregue a mano pisaría la clave
  // de una de ellas y React reusaría la fila equivocada.
  const [nextKey, setNextKey] = useState((renglonesIniciales?.length ?? 0) + 1);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  function addCatalogLine(itemId: string) {
    const item = itemById.get(itemId);
    if (!item) return;
    setLines((ls) => {
      const existing = ls.find((l) => l.catalogItemId === itemId);
      if (existing) {
        return ls.map((l) => (l.catalogItemId === itemId ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...ls,
        {
          key: nextKey,
          catalogItemId: item.id,
          description: item.name,
          qty: 1,
          unitPriceCents: item.price_cents,
          taxRate: item.tax_rate,
        },
      ];
    });
    setNextKey((k) => k + 1);
  }

  function addManualLine() {
    setLines((ls) => [
      ...ls,
      { key: nextKey, catalogItemId: null, description: '', qty: 1, unitPriceCents: 0, taxRate: 19 },
    ]);
    setNextKey((k) => k + 1);
  }

  function updateLine(key: number, patch: Partial<CartLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: number) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  // Totales en vivo con el dominio (mismo redondeo half-up del servidor).
  const totals = useMemo(() => {
    try {
      return computeInvoiceTotals(
        lines.map((l) =>
          computeLineAmounts({ qty: l.qty, unitPriceCents: l.unitPriceCents, taxRate: l.taxRate }),
        ),
      );
    } catch {
      return null;
    }
  }, [lines]);

  const posWarning =
    totals && docKind === 'POS'
      ? checkPosThreshold(totals.subtotalCents - totals.discountCents, uvtValueCents)
      : null;

  function buildInput(): CreateDraftInput {
    return {
      ownerId: ownerId ?? null,
      patientId: patientId ?? null,
      consultationId: consultationId ?? null,
      docKind,
      lines: lines.map((l) => ({
        catalogItemId: l.catalogItemId,
        description: l.catalogItemId ? null : l.description,
        qty: l.qty,
        unitPriceCents: l.catalogItemId ? null : l.unitPriceCents,
        taxRate: l.catalogItemId ? null : l.taxRate,
      })),
    };
  }

  function submit(mode: 'draft' | 'issue') {
    setError(null);
    setWarnings([]);
    if (lines.length === 0) {
      setError('Agrega al menos una línea.');
      return;
    }
    const planError = mode === 'issue' ? validatePlan(plan, totals?.totalCents ?? 0) : null;
    if (planError) {
      setError(planError);
      return;
    }
    startTransition(async () => {
      // Idempotencia del reintento: si la emisión falló, el borrador YA existe. Volver a pulsar
      // "Emitir" con el carrito sin cambios reintenta la emisión sobre ese borrador — antes cada
      // reintento llamaba createInvoiceDraft de nuevo y dejaba N borradores huérfanos.
      const input = buildInput();
      const inputKey = JSON.stringify(input);
      let draft = draftRef.current?.key === inputKey ? draftRef.current : null;
      if (!draft) {
        const created = await createInvoiceDraft(input);
        if (!created.ok) {
          setError(created.error);
          return;
        }
        draft = {
          key: inputKey,
          id: created.invoice.id,
          url: created.url,
          warnings: created.preview.warnings.map((w) => w.message),
        };
        draftRef.current = draft;
      }
      if (mode === 'draft') {
        // Con avisos del servidor (stock insuficiente, datos del pagador incompletos…) no se
        // navega en silencio: antes se tiraban a la basura y solo se mostraban si la emisión
        // fallaba. El borrador YA quedó guardado; el usuario los lee y sigue con el enlace.
        if (draft.warnings.length > 0) {
          setWarnings(draft.warnings);
          setDraftUrl(draft.url);
          return;
        }
        router.push(draft.url);
        return;
      }
      const fields = planToActionFields(plan);
      const issued = await issueInvoiceAction({
        invoiceId: draft.id,
        outcome: fields.outcome,
        method: fields.method,
        amountCents: fields.amountCents,
        reference: fields.reference,
        dueDate: fields.dueDate,
        followupEnabled: fields.followupEnabled,
      });
      if (!issued.ok) {
        setWarnings(draft.warnings);
        setDraftUrl(draft.url);
        setError(`El borrador quedó guardado, pero no se pudo emitir: ${issued.error}`);
        return;
      }
      // LOS AVISOS NO SE TIRAN EN EL CAMINO FELIZ.
      //
      // Estaban calculados —el servidor los devuelve en el borrador— y se mostraban SÓLO al guardar
      // borrador o si la emisión fallaba. Al emitir bien, se descartaban.
      //
      // Medido el 23-ago contra producción: se emitió una factura de un producto con existencia 0 y
      // `track_stock` encendido. Quedó en -1, y en pantalla no apareció nada. El defecto no es el
      // saldo negativo —`block_on_insufficient_stock` está en `false` a propósito, para no frenar
      // una venta por atraso de la contabilidad— sino que el aviso que acompaña esa decisión no
      // llegaba: con la advertencia invisible, "avisar sin bloquear" y "no hacer nada" son lo mismo.
      //
      // Va como toast y no como corte: el documento YA se emitió y no se puede deshacer sin nota
      // crédito, así que interrumpir acá no arregla nada — informar, sí. Sobrevive a la navegación
      // porque el Toaster vive en el layout.
      if (draft.warnings.length > 0) {
        toast.warning(draft.warnings.join(' · '), { duration: 10_000 });
      }
      router.push(issued.url);
    });
  }

  return (
    <div className="space-y-5">
      {/* Contexto del cliente */}
      <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
        <span className="text-fg-faint">Facturar a: </span>
        <span className="font-medium text-fg">{ownerName ?? 'Consumidor final'}</span>
        {patientName && <span className="text-fg-muted"> · paciente {patientName}</span>}
        {consultationId && <span className="text-fg-muted"> · consulta asociada</span>}
      </div>

      {/* Agregar líneas */}
      <div className="flex flex-wrap items-start gap-2">
        <CatalogPicker items={items} onPick={addCatalogLine} />
        <button
          type="button"
          onClick={addManualLine}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition"
        >
          <Plus className="size-4" aria-hidden />
          Línea libre
        </button>
      </div>

      {/* Líneas */}
      {lines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-faint">
          El carrito está vacío. Agrega servicios o productos del catálogo, o una
          línea libre.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-faint">
                <th className="px-4 py-2 font-medium">Descripción</th>
                <th className="px-2 py-2 font-medium">Cant.</th>
                <th className="px-2 py-2 font-medium">Precio unit.</th>
                <th className="px-2 py-2 font-medium">IVA</th>
                <th className="px-2 py-2 text-right font-medium">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const amounts = (() => {
                  try {
                    return computeLineAmounts({
                      qty: l.qty,
                      unitPriceCents: l.unitPriceCents,
                      taxRate: l.taxRate,
                    });
                  } catch {
                    return null;
                  }
                })();
                return (
                  <tr key={l.key} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2">
                      {l.catalogItemId ? (
                        <span className="text-fg">{l.description}</span>
                      ) : (
                        <input
                          value={l.description}
                          onChange={(e) => updateLine(l.key, { description: e.target.value })}
                          placeholder="Descripción del servicio/producto"
                          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min={0.25}
                        step={0.25}
                        value={l.qty}
                        onChange={(e) => updateLine(l.key, { qty: Number(e.target.value) })}
                        className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    </td>
                    <td className="px-2 py-2">
                      {l.catalogItemId ? (
                        <span className="text-fg-muted">{formatCOP(l.unitPriceCents)}</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={l.unitPriceCents / 100}
                          onChange={(e) =>
                            updateLine(l.key, {
                              unitPriceCents: Math.round(Number(e.target.value) * 100),
                            })
                          }
                          className="w-28 rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {l.catalogItemId ? (
                        <span className="text-fg-muted">{l.taxRate}%</span>
                      ) : (
                        <select
                          value={l.taxRate}
                          onChange={(e) => updateLine(l.key, { taxRate: Number(e.target.value) })}
                          className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <option value={0}>0%</option>
                          <option value={5}>5%</option>
                          <option value={19}>19%</option>
                        </select>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right text-fg">
                      {amounts ? formatCOP(amounts.totalCents) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        className="rounded-md p-1 text-fg-faint hover:bg-surface-2 hover:text-warn transition"
                        aria-label="Quitar línea"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Documento + pago + totales */}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <div>
            <label className="block text-xs font-medium text-fg-muted">Tipo de documento</label>
            <select
              value={docKind}
              onChange={(e) => setDocKind(e.target.value as DocKind)}
              className="mt-1 w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="POS">Tiquete POS electrónico</option>
              <option value="FACTURA_VENTA">Factura electrónica de venta</option>
            </select>
          </div>
          <PaymentSection
            plan={plan}
            onChange={setPlan}
            totalCents={totals?.totalCents ?? 0}
            defaultTermsDays={defaultTermsDays}
            reminderChannel={reminderChannel}
            remindersEnabled={remindersEnabled}
          />

          {posWarning?.exceeds && (
            <p className="flex items-start gap-2 rounded-lg border border-warn bg-surface-2 px-3 py-2 text-xs text-warn">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {posWarning.message}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface p-4 text-sm">
          <dl className="space-y-1.5">
            <div className="flex justify-between text-fg-muted">
              <dt>Subtotal</dt>
              <dd>{totals ? formatCOP(totals.subtotalCents) : '—'}</dd>
            </div>
            <div className="flex justify-between text-fg-muted">
              <dt>IVA</dt>
              <dd>{totals ? formatCOP(totals.taxCents) : '—'}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold text-fg">
              <dt>Total</dt>
              <dd>{totals ? formatCOP(totals.totalCents) : '—'}</dd>
            </div>
          </dl>
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-warn bg-surface-2 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {error}
            {draftUrl && (
              <>
                {' '}
                <Link href={draftUrl} className="font-medium underline underline-offset-2">
                  Abrir el borrador guardado
                </Link>
              </>
            )}
          </span>
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs text-fg-muted">
          {warnings.map((w, i) => (
            <li key={i}>· {w}</li>
          ))}
          {!error && draftUrl && (
            <li className="pt-1">
              El borrador quedó guardado.{' '}
              <Link href={draftUrl} className="font-medium text-brand underline underline-offset-2">
                Continuar al borrador
              </Link>
            </li>
          )}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit('issue')}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
        >
          {isPending ? 'Procesando…' : 'Emitir ahora'}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit('draft')}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition disabled:opacity-60"
        >
          Guardar borrador
        </button>
        <span className="text-xs text-fg-faint">
          Emitir asigna consecutivo y transmite el documento — solo se corrige con
          nota crédito.
        </span>
      </div>
    </div>
  );
}

// ─── Selector de catálogo con búsqueda + filtro por tipo ─────────────────────

const TYPE_FILTERS = [
  { key: '', label: 'Todo' },
  { key: 'SERVICIO', label: 'Servicios' },
  { key: 'PRODUCTO', label: 'Productos' },
  { key: 'MEDICAMENTO', label: 'Medicamentos' },
  { key: 'INSUMO', label: 'Insumos' },
] as const;

const TYPE_LABELS: Record<string, string> = {
  SERVICIO: 'Servicio',
  PRODUCTO: 'Producto',
  MEDICAMENTO: 'Medicamento',
  INSUMO: 'Insumo',
};

function CatalogPicker({
  items,
  onPick,
}: {
  items: CatalogItemRow[];
  onPick: (itemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cerrar al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => (typeFilter ? i.item_type === typeFilter : true))
      .filter((i) => (q ? i.name.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q) : true))
      .slice(0, 60);
  }, [items, query, typeFilter]);

  // Agrupar por tipo cuando se ve "Todo" (con filtro activo la lista es plana).
  const grouped = useMemo(() => {
    if (typeFilter) return [[typeFilter, filtered] as const];
    const map = new Map<string, CatalogItemRow[]>();
    for (const i of filtered) {
      const arr = map.get(i.item_type) ?? [];
      arr.push(i);
      map.set(i.item_type, arr);
    }
    // Servicios primero (lo más facturado), luego el resto.
    const order = ['SERVICIO', 'MEDICAMENTO', 'PRODUCTO', 'INSUMO'];
    return order.filter((t) => map.has(t)).map((t) => [t, map.get(t)!] as const);
  }, [filtered, typeFilter]);

  // Nota del port: en el origen esto era una función `pick(id)` que el onClick llamaba. La regla
  // `react-hooks/refs` del compilador de React no puede probar que ese closure solo corre en el
  // click (la lectura del ref queda a una indirección) y lo marcaba como acceso en render. El
  // handler ahora es directo — mismo comportamiento, análisis demostrable.
  function pick(id: string) {
    onPick(id);
    setQuery('');
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint"
          aria-hidden
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar en el catálogo (nombre o SKU)…"
          className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-popover">
          {/* Filtros por tipo */}
          <div className="flex flex-wrap gap-1 border-b border-line px-2 py-2">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setTypeFilter(f.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  typeFilter === f.key
                    ? 'bg-brand text-on-brand'
                    : 'bg-surface-2 text-fg-muted hover:text-fg'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-fg-faint">
                Sin resultados{query ? ` para «${query}»` : ''}.
              </p>
            ) : (
              grouped.map(([type, groupItems]) => (
                <div key={type}>
                  {!typeFilter && (
                    <p className="sticky top-0 bg-surface-2 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-fg-faint">
                      {TYPE_LABELS[type] ?? type}
                    </p>
                  )}
                  {groupItems.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => {
                        pick(i.id)
                        inputRef.current?.focus() // seguir agregando sin reabrir
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2 transition"
                    >
                      <span className="min-w-0 truncate text-fg">{i.name}</span>
                      <span className="shrink-0 text-xs text-fg-muted">
                        {formatCOP(i.price_cents)}
                        <span className="ml-1.5 text-fg-faint">
                          {i.tax_status === 'GRAVADO' ? `IVA ${i.tax_rate}%` : 'sin IVA'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

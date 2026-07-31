import Link from 'next/link';
import { ArrowLeft, AlertTriangle, ArrowLeftRight, FileUp, BookOpen, ShoppingCart } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import {
  ensureDefaultCategories,
  getBillingSettings,
  getNearExpirySet,
  getRecentMovements,
  getStockMap,
  listCatalogItems,
  listCategories,
} from '@/lib/facturacion/queries';
import { computeInventorySummary } from '@/lib/facturacion/domain/inventory';
import { formatCOP } from '@/lib/facturacion/format';
import { MovementForm } from '@/components/facturacion/MovementForm';
import { InventorySearch } from '@/components/facturacion/InventorySearch';
import { ImportBatchesList } from '@/components/facturacion/ImportBatchesList';
import type { ImportBatchRow } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

const TYPE_LABELS: Record<string, string> = {
  SERVICIO: 'Servicio',
  PRODUCTO: 'Producto',
  MEDICAMENTO: 'Medicamento',
  INSUMO: 'Insumo',
};

const MOVEMENT_LABELS: Record<string, string> = {
  CARGA_INICIAL: 'Carga inicial',
  ENTRADA_COMPRA: 'Compra',
  SALIDA_VENTA: 'Venta',
  SALIDA_APLICACION: 'Aplicación',
  CONSUMO_INTERNO: 'Consumo interno',
  DEVOLUCION: 'Devolución',
  VENCIMIENTO: 'Vencimiento',
  PERDIDA: 'Pérdida',
  AJUSTE: 'Ajuste',
};

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'ok' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-fg-faint">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold ${
          tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-fg'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string; type?: string }>;
}) {
  const sp = await searchParams;
  // Verificación local del JWT (sin round-trip) — patrón getCachedUser.
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const settings = await getBillingSettings(supabase, clinicId);
  const active = settings?.module_status === 'ACTIVO';

  if (!active) {
    return (
      <main className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-5xl px-8 py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Inventario</h1>
          <p className="mt-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
            El módulo no está activo.{' '}
            <Link href="/dashboard/facturacion/configuracion" className="underline underline-offset-2">
              Configúralo primero
            </Link>
            .
          </p>
        </div>
      </main>
    );
  }

  await ensureDefaultCategories(supabase, clinicId);

  const [categories, items] = await Promise.all([
    listCategories(supabase, clinicId),
    listCatalogItems(supabase, clinicId, {}), // solo activos
  ]);
  const trackedIds = items.filter((i) => i.track_stock).map((i) => i.id);
  const [stockMap, nearExpiry, recent] = await Promise.all([
    getStockMap(supabase, clinicId, trackedIds),
    getNearExpirySet(supabase, clinicId, trackedIds, new Date()),
    getRecentMovements(supabase, clinicId, 12),
  ]);

  const summary = computeInventorySummary(items, stockMap, nearExpiry);

  const defaultCat = categories.find((c) => c.is_default) ?? null;
  const effectiveCat = (categoryId: string | null) => categoryId ?? defaultCat?.id ?? null;
  const countByCat = new Map<string, number>();
  for (const it of items) {
    const c = effectiveCat(it.category_id);
    if (c) countByCat.set(c, (countByCat.get(c) ?? 0) + 1);
  }

  // Filtro en memoria para la tabla (los KPIs siempre son sobre todo el activo).
  const q = sp.q?.trim().toLowerCase() ?? '';
  const filtered = items.filter((i) => {
    if (sp.cat && effectiveCat(i.category_id) !== sp.cat) return false;
    if (sp.type && i.item_type !== sp.type) return false;
    if (q) {
      const hay = `${i.name} ${i.sku ?? ''} ${i.barcode ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const { data: batchData } = await supabase
    .from('import_batches')
    .select('*')
    .eq('clinic_id', clinicId)
    .neq('status', 'PREVIEW')
    .order('created_at', { ascending: false })
    .limit(10);
  const batches = (batchData as ImportBatchRow[] | null) ?? [];

  const chipHref = (catId: string | null) => {
    const p = new URLSearchParams();
    if (catId) p.set('cat', catId);
    if (sp.q) p.set('q', sp.q);
    if (sp.type) p.set('type', sp.type);
    const qs = p.toString();
    return `/dashboard/facturacion/inventario${qs ? `?${qs}` : ''}`;
  };
  const chipCls = (activeChip: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
      activeChip
        ? 'border-brand bg-brand text-on-brand'
        : 'border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg'
    }`;

  return (
    <main className="flex-1 min-w-0">
      <div className="mx-auto w-full max-w-5xl px-8 py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link
              href="/dashboard/facturacion"
              className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Facturación
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Inventario</h1>
            <p className="mt-1 text-sm text-fg-faint">
              Existencias derivadas de los movimientos — nunca se editan a mano.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/facturacion/catalogo"
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition"
            >
              <BookOpen className="size-4" aria-hidden />
              Catálogo
            </Link>
            <Link
              href="/dashboard/facturacion/compras"
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition"
            >
              <ShoppingCart className="size-4" aria-hidden />
              Compras
            </Link>
            <Link
              href="/dashboard/facturacion/inventario/movimientos"
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition"
            >
              <ArrowLeftRight className="size-4" aria-hidden />
              Movimientos
            </Link>
            {/* El destino existe y explica por qué está deshabilitado, pero prometía "Importar" a
                secas: se llegaba esperando importar y salía un "próximamente". Que se sepa antes
                de hacer clic. */}
            <Link
              href="/dashboard/facturacion/inventario/importar"
              title="La importación desde Excel está deshabilitada mientras reemplazamos la librería de planillas; al entrar te contamos las alternativas."
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition"
            >
              <FileUp className="size-4" aria-hidden />
              Importar
              <span className="rounded-full border border-line-soft px-1.5 py-px text-[10px] uppercase tracking-wide text-fg-faint">
                pronto
              </span>
            </Link>
          </div>
        </header>

        {/* KPIs */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="Ítems activos" value={String(summary.activeItems)} />
          <Kpi label="Valor a costo" value={formatCOP(summary.valueAtCostCents)} />
          <Kpi label="Bajo mínimo" value={String(summary.lowStock)} tone={summary.lowStock ? 'warn' : undefined} />
          <Kpi label="Agotados" value={String(summary.outOfStock)} tone={summary.outOfStock ? 'warn' : undefined} />
          <Kpi label="Por vencer" value={String(summary.nearExpiry)} tone={summary.nearExpiry ? 'warn' : undefined} />
        </div>

        {/* Navegación por categorías */}
        <div className="mb-3 flex flex-wrap gap-2">
          <Link href={chipHref(null)} className={chipCls(!sp.cat)}>
            Todas <span className="opacity-60">{items.length}</span>
          </Link>
          {categories.map((c) => (
            <Link key={c.id} href={chipHref(c.id)} className={chipCls(sp.cat === c.id)}>
              {c.name} <span className="opacity-60">{countByCat.get(c.id) ?? 0}</span>
            </Link>
          ))}
        </div>

        {/* Buscador + tipo */}
        <div className="mb-4">
          <InventorySearch />
        </div>

        {summary.lowStock > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-warn bg-surface-2 px-4 py-3 text-sm text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {summary.lowStock} ítem(s) por debajo del mínimo y {summary.outOfStock} agotado(s).
            </span>
          </div>
        )}

        {/* Tabla */}
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          {filtered.length === 0 ? (
            <p className="px-5 py-8 text-sm text-fg-faint">
              Ningún ítem coincide.{' '}
              <Link href="/dashboard/facturacion/catalogo" className="underline underline-offset-2">
                Agrega ítems en el catálogo
              </Link>
              .
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg-faint">
                  <th className="px-5 py-2 font-medium">Nombre</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 text-right font-medium">Precio</th>
                  <th className="px-3 py-2 text-right font-medium">Existencia</th>
                  <th className="px-5 py-2 font-medium">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const stock = stockMap.get(i.id);
                  const low =
                    i.track_stock && i.min_stock !== null && (stock ?? 0) < Number(i.min_stock);
                  const out = i.track_stock && (stock ?? 0) <= 0;
                  return (
                    <tr key={i.id} className="border-b border-line/60 last:border-0">
                      <td className="px-5 py-2.5 font-medium text-fg">{i.name}</td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {TYPE_LABELS[i.item_type] ?? i.item_type}
                      </td>
                      <td className="px-3 py-2.5 text-right text-fg">{formatCOP(i.price_cents)}</td>
                      <td className="px-3 py-2.5 text-right text-fg-muted">
                        {i.track_stock ? `${stock ?? 0} ${i.use_unit}` : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-xs">
                        {out && <span className="text-warn">Agotado</span>}
                        {low && !out && <span className="text-warn">Bajo mínimo</span>}
                        {nearExpiry.has(i.id) && <span className="ml-2 text-warn">Lote por vencer</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Registrar movimiento */}
        <div className="mt-6">
          <MovementForm items={items} />
        </div>

        {/* Movimientos recientes */}
        {recent.length > 0 && (
          <div className="mt-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-fg">Movimientos recientes</h2>
              <Link
                href="/dashboard/facturacion/inventario/movimientos"
                className="text-xs text-fg-faint underline-offset-2 hover:text-fg hover:underline"
              >
                Ver todos
              </Link>
            </div>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
              {recent.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 truncate text-fg">
                    {m.item?.name ?? '(ítem eliminado)'}
                  </span>
                  <span className="shrink-0 text-xs text-fg-faint">
                    {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
                  </span>
                  <span
                    className={`w-20 shrink-0 text-right font-medium ${m.qty >= 0 ? 'text-ok' : 'text-warn'}`}
                  >
                    {m.qty >= 0 ? '+' : ''}
                    {m.qty}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8">
          <ImportBatchesList batches={batches} />
        </div>
      </div>
    </main>
  );
}

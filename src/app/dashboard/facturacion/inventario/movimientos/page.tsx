import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import { getBillingSettings, listCatalogItems, listMovements } from '@/lib/facturacion/queries';
import { MovementForm } from '@/components/facturacion/MovementForm';
import { MovementsExport } from '@/components/facturacion/MovementsExport';
import { TrLink } from '@/components/ui/TrLink';

export const metadata = { title: "Movimientos de inventario · Tuvetia" }


export const dynamic = 'force-dynamic';

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

const PAGE_SIZE = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` local Bogotá de un timestamptz (UTC-5 fijo). */
function dateKeyBogota(iso: string): string {
  return new Date(new Date(iso).getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<{
    dir?: string;
    type?: string;
    item?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const settings = await getBillingSettings(supabase, clinicId);
  const active = settings?.module_status === 'ACTIVO';

  const sp = await searchParams;
  const dir = sp.dir === 'entrada' || sp.dir === 'salida' ? sp.dir : undefined;
  const type = sp.type && MOVEMENT_LABELS[sp.type] ? sp.type : undefined;
  const from = DATE_RE.test(sp.from ?? '') ? sp.from : undefined;
  const to = DATE_RE.test(sp.to ?? '') ? sp.to : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  if (!active) {
    return (
      <section className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-5xl px-8 py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Movimientos</h1>
          <p className="mt-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
            El módulo no está activo.{' '}
            <Link href="/dashboard/facturacion/configuracion" className="underline underline-offset-2">
              Configúralo primero
            </Link>
            .
          </p>
        </div>
      </section>
    );
  }

  const items = await listCatalogItems(supabase, clinicId, {});
  const itemFilter = items.some((i) => i.id === sp.item) ? sp.item : undefined;

  const { movements, total } = await listMovements(supabase, clinicId, {
    dir,
    type,
    itemId: itemFilter,
    from,
    to,
    page,
    pageSize: PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (dir) params.set('dir', dir);
    if (type) params.set('type', type);
    if (itemFilter) params.set('item', itemFilter);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return `/dashboard/facturacion/inventario/movimientos${qs ? `?${qs}` : ''}`;
  };

  const csvRows = movements.map((m) => ({
    date: dateKeyBogota(m.created_at),
    item: m.item?.name ?? '(ítem eliminado)',
    type: MOVEMENT_LABELS[m.movement_type] ?? m.movement_type,
    qty: Number(m.qty),
    unit: m.item?.use_unit ?? '',
    note: m.note ?? '',
  }));

  const inputCls =
    'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
  const chipCls = (activeChip: boolean) =>
    `inline-flex items-center rounded-full border px-3 py-1 text-xs transition ${
      activeChip
        ? 'border-brand bg-brand text-on-brand'
        : 'border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg'
    }`;

  const dirHref = (d?: 'entrada' | 'salida') => {
    const params = new URLSearchParams();
    if (d) params.set('dir', d);
    if (type) params.set('type', type);
    if (itemFilter) params.set('item', itemFilter);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return `/dashboard/facturacion/inventario/movimientos${qs ? `?${qs}` : ''}`;
  };

  return (
    <section className="flex-1 min-w-0">
      <div className="mx-auto w-full max-w-5xl px-8 py-10">
        <header className="mb-6">
          <Link
            href="/dashboard/facturacion/inventario"
            className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Inventario
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg">
            <ArrowLeftRight className="size-6 text-fg-muted" aria-hidden />
            Movimientos y salidas
          </h1>
          <p className="mt-1 text-sm text-fg-faint">
            Historial completo de entradas y salidas. La existencia siempre es la suma
            de estos movimientos.
          </p>
        </header>

        {/* Dirección */}
        <div className="mb-3 flex flex-wrap gap-2">
          <Link href={dirHref(undefined)} className={chipCls(!dir)}>
            Todos
          </Link>
          <Link href={dirHref('entrada')} className={chipCls(dir === 'entrada')}>
            Entradas
          </Link>
          <Link href={dirHref('salida')} className={chipCls(dir === 'salida')}>
            Salidas
          </Link>
        </div>

        {/* Filtros (GET) */}
        <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
          {dir && <input type="hidden" name="dir" value={dir} />}
          <label className="text-xs text-fg-muted">
            Tipo
            <select name="type" defaultValue={type ?? ''} className={`${inputCls} mt-1 block`}>
              <option value="">Todos</option>
              {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-fg-muted">
            Ítem
            <select name="item" defaultValue={itemFilter ?? ''} className={`${inputCls} mt-1 block max-w-56`}>
              <option value="">Todos</option>
              {items
                .filter((i) => i.track_stock)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-fg-muted">
            Desde
            <input type="date" name="from" defaultValue={from} className={`${inputCls} mt-1 block`} />
          </label>
          <label className="text-xs text-fg-muted">
            Hasta
            <input type="date" name="to" defaultValue={to} className={`${inputCls} mt-1 block`} />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:text-fg transition"
          >
            Aplicar
          </button>
        </form>

        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-fg-muted">
            {total === 1 ? '1 movimiento' : `${total} movimientos`}
            {pages > 1 && ` · página ${page} de ${pages}`}
          </p>
          <MovementsExport rows={csvRows} />
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          {movements.length === 0 ? (
            <p className="px-5 py-8 text-sm text-fg-faint">
              Sin movimientos con estos filtros.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg-faint">
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-2 py-2 font-medium">Ítem</th>
                  <th className="px-2 py-2 font-medium">Tipo</th>
                  <th className="px-2 py-2 text-right font-medium">Cantidad</th>
                  <th className="px-4 py-2 font-medium">Nota</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  // Fila clicable hacia el documento de origen del movimiento.
                  const href =
                    m.ref_type === 'PURCHASE' && m.ref_id
                      ? `/dashboard/facturacion/compras/${m.ref_id}`
                      : m.ref_type === 'INVOICE' && m.ref_id
                        ? `/dashboard/facturacion/${m.ref_id}`
                        : null;
                  const cells = (
                    <>
                      <td className="px-4 py-2 font-mono text-xs tabular-nums text-fg-muted">
                        {dateKeyBogota(m.created_at)}
                      </td>
                      <td className="px-2 py-2 text-fg">{m.item?.name ?? '(ítem eliminado)'}</td>
                      <td className="px-2 py-2 text-xs text-fg-muted">
                        {MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
                        {href && <span className="ml-1 text-fg-faint">↗</span>}
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono text-xs tabular-nums ${
                          Number(m.qty) >= 0 ? 'text-ok' : 'text-warn'
                        }`}
                      >
                        {Number(m.qty) >= 0 ? '+' : ''}
                        {Number(m.qty)} {m.item?.use_unit ?? ''}
                      </td>
                      <td className="px-4 py-2 text-xs text-fg-faint">{m.note ?? '—'}</td>
                    </>
                  );
                  return href ? (
                    <TrLink
                      key={m.id}
                      href={href}
                      className="border-b border-line/60 last:border-0 hover:bg-surface-2/50"
                    >
                      {cells}
                    </TrLink>
                  ) : (
                    <tr key={m.id} className="border-b border-line/60 last:border-0">
                      {cells}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Paginación */}
        {pages > 1 && (
          <div className="mt-4 flex items-center gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className={`${inputCls} hover:text-fg`}>
                ← Anterior
              </Link>
            )}
            {page < pages && (
              <Link href={pageHref(page + 1)} className={`${inputCls} hover:text-fg`}>
                Siguiente →
              </Link>
            )}
          </div>
        )}

        {/* Registrar salida/ajuste manual */}
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-medium text-fg">Registrar movimiento manual</h2>
          <MovementForm items={items} />
        </div>
      </div>
    </section>
  );
}

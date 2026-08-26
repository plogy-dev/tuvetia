import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import { getPurchaseDetail } from '@/lib/facturacion/queries';
import { formatCOP } from '@/lib/facturacion/domain/money';
import { PurchaseDetailActions } from '@/components/facturacion/PurchaseDetailActions';
import { PageShell } from '@/components/ui/page-shell';

export const metadata = { title: "Compra · Tuvetia" }


export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  BORRADOR: 'border-line text-fg-muted',
  CONFIRMADA: 'border-ok/40 text-ok',
  ANULADA: 'border-warn/40 text-warn',
};

export default async function CompraDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const detail = await getPurchaseDetail(supabase, clinicId, id);
  if (!detail) notFound();
  const { purchase, items } = detail;

  return (
    <PageShell>
      <header>
        <Link
          href="/dashboard/facturacion/compras"
          className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Compras
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Compra {purchase.doc_number ?? purchase.purchased_on}
          </h1>
          <span
            className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              STATUS_BADGE[purchase.status] ?? 'border-line text-fg-muted'
            }`}
          >
            {purchase.status.charAt(0) + purchase.status.slice(1).toLowerCase()}
          </span>
        </div>
        <p className="mt-1 text-sm text-fg-faint">
          {[
            purchase.supplier?.name,
            purchase.purchased_on,
            purchase.method &&
              purchase.method.charAt(0) + purchase.method.slice(1).toLowerCase(),
            purchase.note,
          ]
            .filter(Boolean)
            .join(' · ') || '—'}
        </p>
      </header>

      <div className="mb-6 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-faint">
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-2 py-2 text-right font-medium">Cantidad</th>
              <th className="px-2 py-2 text-right font-medium">Costo unitario</th>
              <th className="px-2 py-2 font-medium">Lote</th>
              <th className="px-2 py-2 font-medium">Vence</th>
              <th className="px-4 py-2 text-right font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-2 text-fg">
                  {l.item?.name ?? '—'}
                  {l.item && l.item.conversion_factor !== 1 && (
                    <span className="ml-2 text-[11px] text-fg-faint">
                      (1 {l.item.purchase_unit} = {l.item.conversion_factor} {l.item.use_unit})
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-fg-muted">
                  {l.qty} {l.item?.purchase_unit ?? ''}
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-fg-muted">
                  {formatCOP(l.unit_cost_cents)}
                </td>
                <td className="px-2 py-2 text-xs text-fg-muted">{l.lot_code ?? '—'}</td>
                <td className="px-2 py-2 font-mono text-xs tabular-nums text-fg-muted">
                  {l.expires_on ?? '—'}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-fg">
                  {formatCOP(Math.round(l.qty * l.unit_cost_cents))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td colSpan={5} className="px-4 py-2.5 text-right text-sm font-medium text-fg">
                Total
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold tabular-nums text-fg">
                {formatCOP(purchase.total_cents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <PurchaseDetailActions purchaseId={purchase.id} status={purchase.status} />
    </PageShell>
  );
}

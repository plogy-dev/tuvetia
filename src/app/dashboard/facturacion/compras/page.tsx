import Link from 'next/link';
import { ArrowLeft, Plus, ShoppingCart, Truck } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import { getBillingSettings, listPurchases } from '@/lib/facturacion/queries';
import { formatCOP } from '@/lib/facturacion/domain/money';
import { TrLink } from '@/components/ui/TrLink';
import { PageShell } from '@/components/ui/page-shell';

export const metadata = { title: "Compras · Tuvetia" }


export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  BORRADOR: 'border-line text-fg-muted',
  CONFIRMADA: 'border-ok/40 text-ok',
  ANULADA: 'border-warn/40 text-warn',
};

export default async function ComprasPage() {
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const settings = await getBillingSettings(supabase, clinicId);
  const active = settings?.module_status === 'ACTIVO';
  const purchases = active ? await listPurchases(supabase, clinicId) : [];

  return (
    <PageShell>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/dashboard/facturacion/inventario"
            className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Inventario
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg">
            <ShoppingCart className="size-6 text-fg-muted" aria-hidden />
            Compras
          </h1>
          <p className="mt-1 text-sm text-fg-faint">
            Compras a proveedores: entran al inventario con su costo y quedan como
            egreso en Finanzas.
          </p>
        </div>
        {active && (
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/facturacion/compras/proveedores"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-muted hover:text-fg transition"
            >
              <Truck className="size-4" aria-hidden />
              Proveedores
            </Link>
            <Link
              href="/dashboard/facturacion/compras/nueva"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition"
            >
              <Plus className="size-4" aria-hidden />
              Nueva compra
            </Link>
          </div>
        )}
      </header>

      {!active ? (
        <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
          El módulo no está activo.{' '}
          <Link href="/dashboard/facturacion/configuracion" className="underline underline-offset-2">
            Configúralo primero
          </Link>
          .
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          {purchases.length === 0 ? (
            <p className="px-5 py-8 text-sm text-fg-faint">
              Todavía no hay compras. Registra la primera con «Nueva compra».
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg-faint">
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-2 py-2 font-medium">Proveedor</th>
                  <th className="px-2 py-2 font-medium">Documento</th>
                  <th className="px-2 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <TrLink
                    key={p.id}
                    href={`/dashboard/facturacion/compras/${p.id}`}
                    className="border-b border-line/60 last:border-0 hover:bg-surface-2/50"
                  >
                    <td className="px-4 py-2 font-mono text-xs tabular-nums text-fg-muted">
                      <Link href={`/dashboard/facturacion/compras/${p.id}`} className="underline-offset-2 hover:underline">
                        {p.purchased_on}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-fg">{p.supplier?.name ?? '—'}</td>
                    <td className="px-2 py-2 text-xs text-fg-muted">{p.doc_number ?? '—'}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          STATUS_BADGE[p.status] ?? 'border-line text-fg-muted'
                        }`}
                      >
                        {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-fg">
                      {formatCOP(p.total_cents)}
                    </td>
                  </TrLink>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </PageShell>
  );
}

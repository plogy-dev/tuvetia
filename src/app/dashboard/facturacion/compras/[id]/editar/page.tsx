import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import { getPurchaseDetail, listCatalogItems, listSuppliers } from '@/lib/facturacion/queries';
import { PurchaseForm } from '@/components/facturacion/PurchaseForm';
import { PageShell } from '@/components/ui/page-shell';

export const metadata = { title: "Editar compra · Tuvetia" }


export const dynamic = 'force-dynamic';

function todayBogota(): string {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function EditarCompraPage({
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
  const { purchase, items: lines } = detail;

  if (purchase.status !== 'BORRADOR') {
    return (
      <PageShell>
        <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
          Solo se edita una compra en borrador.{' '}
          <Link href={`/dashboard/facturacion/compras/${id}`} className="underline underline-offset-2">
            Ábrela y usa «Reabrir para editar»
          </Link>
          .
        </p>
      </PageShell>
    );
  }

  const [suppliers, catalog] = await Promise.all([
    listSuppliers(supabase, clinicId),
    listCatalogItems(supabase, clinicId),
  ]);
  const items = catalog
    .filter((i) => i.item_type !== 'SERVICIO')
    .map((i) => ({
      id: i.id,
      name: i.name,
      purchase_unit: i.purchase_unit,
      use_unit: i.use_unit,
      conversion_factor: i.conversion_factor,
      cost_cents: i.cost_cents,
    }));

  return (
    <PageShell>
      <header>
        <Link
          href={`/dashboard/facturacion/compras/${id}`}
          className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Detalle de la compra
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Editar compra</h1>
        <p className="mt-1 text-sm text-fg-faint">
          Ajusta lo que necesites y confirma: el stock, los costos y el egreso se
          recalculan con los valores nuevos.
        </p>
      </header>

      <PurchaseForm
        suppliers={suppliers}
        items={items}
        today={todayBogota()}
        initial={{
          id: purchase.id,
          supplierId: purchase.supplier_id,
          purchasedOn: purchase.purchased_on,
          docNumber: purchase.doc_number,
          method: purchase.method,
          note: purchase.note,
          lines: lines.map((l) => ({
            catalogItemId: l.catalog_item_id,
            qty: Number(l.qty),
            unitCostCents: l.unit_cost_cents,
            lotCode: l.lot_code,
            expiresOn: l.expires_on,
          })),
        }}
      />
    </PageShell>
  );
}

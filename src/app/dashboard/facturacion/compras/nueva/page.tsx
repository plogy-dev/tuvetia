import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import { getBillingSettings, listCatalogItems, listSuppliers } from '@/lib/facturacion/queries';
import { PurchaseForm } from '@/components/facturacion/PurchaseForm';
import { PageShell } from '@/components/ui/page-shell';

export const metadata = { title: "Nueva compra · Tuvetia" }


export const dynamic = 'force-dynamic';

function todayBogota(): string {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function NuevaCompraPage() {
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const settings = await getBillingSettings(supabase, clinicId);
  const active = settings?.module_status === 'ACTIVO';

  const [suppliers, catalog] = active
    ? await Promise.all([
        listSuppliers(supabase, clinicId),
        listCatalogItems(supabase, clinicId),
      ])
    : [[], []];

  // Solo lo comprable: productos, medicamentos e insumos (no servicios).
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
          href="/dashboard/facturacion/compras"
          className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Compras
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Nueva compra</h1>
        <p className="mt-1 text-sm text-fg-faint">
          Registra lo que llegó del proveedor: cantidades en unidad de compra y costo
          por unidad. Al confirmar, entra al inventario y queda el egreso.
        </p>
      </header>

      {!active ? (
        <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
          El módulo no está activo.{' '}
          <Link href="/dashboard/facturacion/configuracion" className="underline underline-offset-2">
            Configúralo primero
          </Link>
          .
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
          No hay productos en el catálogo todavía.{' '}
          <Link href="/dashboard/facturacion/catalogo" className="underline underline-offset-2">
            Crea o importa productos primero
          </Link>
          .
        </p>
      ) : (
        <PurchaseForm suppliers={suppliers} items={items} today={todayBogota()} />
      )}
    </PageShell>
  );
}

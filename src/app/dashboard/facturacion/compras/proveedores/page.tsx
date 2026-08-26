import Link from 'next/link';
import { ArrowLeft, Truck } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import { getBillingSettings, listSuppliers } from '@/lib/facturacion/queries';
import { SupplierManager } from '@/components/facturacion/SupplierManager';
import { PageShell } from '@/components/ui/page-shell';

export const metadata = { title: "Proveedores · Tuvetia" }


export const dynamic = 'force-dynamic';

export default async function ProveedoresPage() {
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const settings = await getBillingSettings(supabase, clinicId);
  const active = settings?.module_status === 'ACTIVO';

  const suppliers = active
    ? await listSuppliers(supabase, clinicId, { includeInactive: true })
    : [];

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
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg">
          <Truck className="size-6 text-fg-muted" aria-hidden />
          Proveedores
        </h1>
        <p className="mt-1 text-sm text-fg-faint">
          Tus proveedores y laboratorios. Se usan en las compras de inventario y
          en la ficha de cada producto.
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
      ) : (
        <SupplierManager suppliers={suppliers} />
      )}
    </PageShell>
  );
}

import Link from 'next/link';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import { getBillingSettings, getActiveRange } from '@/lib/facturacion/queries';
import { SettingsForm } from '@/components/facturacion/SettingsForm';

export const metadata = { title: "Configuración de ventas · Tuvetia" }


export const dynamic = 'force-dynamic';

export default async function ConfiguracionFacturacionPage() {
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const settings = await getBillingSettings(supabase, clinicId);
  const activeRange = settings
    ? await getActiveRange(supabase, clinicId, settings.default_doc_kind)
    : null;

  return (
    <section className="flex-1 min-w-0">
      <div className="mx-auto w-full max-w-3xl px-8 py-10">
        <header className="mb-8">
          <Link
            href="/dashboard/facturacion"
            className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Facturación
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Configuración de facturación
          </h1>
          <p className="mt-1 text-sm text-fg-faint">
            Datos del emisor, funciones del módulo y tipo de documento por defecto.
          </p>
        </header>

        {activeRange?.is_sandbox && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
            <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Estás en <strong>modo sandbox</strong>: rango de prueba{' '}
              <code className="text-xs">
                {activeRange.prefix}-{activeRange.range_from}…{activeRange.range_to}
              </code>{' '}
              con CUFE simulado. Los documentos NO tienen validez fiscal hasta
              conectar el proveedor DIAN.
            </span>
          </div>
        )}

        <SettingsForm settings={settings} />
      </div>
    </section>
  );
}

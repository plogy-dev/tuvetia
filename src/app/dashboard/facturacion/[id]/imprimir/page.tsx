/**
 * Print-route A4 de la factura (vista del VET, autenticada). Renderiza el
 * documento compartido (InvoiceDocument) + auto window.print(). La versión
 * pública para el cliente vive en /f/[token].
 */
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import { getBillingSettings, getInvoiceDetail } from '@/lib/facturacion/queries';
import {
  INVOICE_DOC_STYLES,
  InvoiceDocument,
} from '@/components/facturacion/InvoiceDocument';
import { PrintAutoTrigger } from '@/components/print/PrintAutoTrigger';
import type { NumberingRangeRow } from '@/lib/supabase/types';

export const metadata = { title: "Imprimir factura · Tuvetia" }


export const dynamic = 'force-dynamic';

export default async function ImprimirFacturaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const [detail, settings] = await Promise.all([
    getInvoiceDetail(supabase, clinicId, id),
    getBillingSettings(supabase, clinicId),
  ]);
  if (!detail || detail.invoice.status === 'BORRADOR') notFound();
  const { invoice, lines, payer, fiscalDocuments } = detail;
  const fiscalDoc = fiscalDocuments[fiscalDocuments.length - 1] ?? null;
  const cufe = fiscalDoc?.cufe ?? null;
  const isSandbox = fiscalDoc?.provider === 'SANDBOX' || !fiscalDoc;

  let range: NumberingRangeRow | null = null;
  if (invoice.numbering_range_id) {
    const { data } = await supabase
      .from('numbering_ranges')
      .select('*')
      .eq('id', invoice.numbering_range_id)
      .maybeSingle();
    range = (data as NumberingRangeRow | null) ?? null;
  }

  const qrSvg = cufe
    ? await QRCode.toString(
        `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}`,
        { type: 'svg', margin: 0, width: 96 },
      )
    : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: INVOICE_DOC_STYLES }} />
      <div className="doc-root">
        {/* ── LA SALIDA VA EN LA BARRA QUE YA EXISTÍA ─────────────────────────────────────────
            Esta ruta se abre con `target="_blank"` desde el panel de acciones: pestaña nueva, sin
            historial. O sea que el «atrás» del navegador está DESHABILITADO, y acá no hay flecha de
            volver, ni `PageShell`, ni cabecera — el `doc-root` tampoco es un overlay. La única
            forma de salir era cerrar la pestaña, y quien no cayera en eso quedaba mirando una
            factura sin nada alrededor.

            Vuelve a la FACTURA y no al libro de ventas: se llegó desde ahí. Y como se abrió en
            pestaña nueva, la del libro sigue intacta detrás. */}
        <PrintAutoTrigger volverA={`/dashboard/facturacion/${id}`} rotuloVolver="Volver a la factura" />
        <InvoiceDocument
          invoice={invoice}
          lines={lines}
          payer={payer}
          emitter={{
            name: settings?.fiscal_name ?? null,
            idType: settings?.fiscal_id_type ?? null,
            idNumber: settings?.fiscal_id_number ?? null,
            regime: settings?.fiscal_regime ?? null,
            address: settings?.fiscal_address ?? null,
          }}
          range={range}
          cufe={cufe}
          isSandbox={isSandbox}
          qrSvg={qrSvg}
        />
      </div>
    </>
  );
}

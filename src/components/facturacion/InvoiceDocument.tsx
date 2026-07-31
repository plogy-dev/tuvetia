// Representación gráfica de la factura / tiquete POS (anexo técnico DIAN:
// emisor, adquiriente, líneas con IVA discriminado, resolución, CUFE, QR).
// La comparten la print-route interna (/app/facturacion/[id]/imprimir) y la
// página pública del cliente (/f/[token]). Server component, sin estado.

import { formatCOP } from '@/lib/facturacion/domain/money';
import type {
  BillingPayerRow,
  InvoiceLineRow,
  InvoiceRow,
  NumberingRangeRow,
} from '@/lib/supabase/types';

export interface InvoiceDocumentProps {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  payer: BillingPayerRow | null;
  emitter: {
    name: string | null;
    idType: string | null;
    idNumber: string | null;
    regime: string | null;
    address: string | null;
  };
  range: NumberingRangeRow | null;
  cufe: string | null;
  isSandbox: boolean;
  qrSvg: string | null;
}

export function InvoiceDocument({
  invoice,
  lines,
  payer,
  emitter,
  range,
  cufe,
  isSandbox,
  qrSvg,
}: InvoiceDocumentProps) {
  const issuedAt = invoice.issued_at ? new Date(invoice.issued_at) : null;
  const issuedLabel = issuedAt
    ? issuedAt.toLocaleString('es-CO', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Bogota',
      })
    : '—';

  const docTitle =
    invoice.doc_kind === 'POS'
      ? 'Documento equivalente electrónico · Tiquete POS'
      : 'Factura electrónica de venta';

  return (
    <article className="doc">
      {isSandbox && <div className="watermark">AMBIENTE DE PRUEBAS</div>}

      <header className="doc-header">
        <div>
          <h1 className="emitter-name">{emitter.name ?? 'Emisor'}</h1>
          <p className="emitter-meta">
            {emitter.idType ?? ''} {emitter.idNumber ?? ''}
            {emitter.regime === 'SIMPLE'
              ? ' · Régimen SIMPLE'
              : emitter.regime === 'NO_RESPONSABLE'
                ? ' · No responsable de IVA'
                : ' · Responsable de IVA'}
          </p>
          {emitter.address && <p className="emitter-meta">{emitter.address}</p>}
        </div>
        <div className="doc-id">
          <p className="doc-kind">{docTitle}</p>
          <p className="doc-number">{invoice.full_number}</p>
          <p className="doc-date">{issuedLabel}</p>
        </div>
      </header>

      <section className="buyer">
        <h2 className="section-title">Adquiriente</h2>
        <p>
          <strong>{payer?.name ?? 'Consumidor final'}</strong>
          {payer && (
            <>
              {' · '}
              {payer.doc_type} {payer.doc_number}
            </>
          )}
        </p>
        {payer?.email && <p className="soft">{payer.email}</p>}
      </section>

      <table className="lines">
        <thead>
          <tr>
            <th>Descripción</th>
            <th className="num">Cant.</th>
            <th className="num">Vr. unitario</th>
            <th className="num">IVA</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description}</td>
              <td className="num">
                {l.qty}
                {l.unit !== 'unidad' ? ` ${l.unit}` : ''}
              </td>
              <td className="num">{formatCOP(l.unit_price_cents)}</td>
              {/* EXENTO (gravado a 0%) y EXCLUIDO (fuera del IVA) son categorías jurídicamente
                  distintas en el régimen colombiano — colapsarlas en "Excluido" iba impreso en el
                  documento que se entrega al cliente. */}
              <td className="num">
                {l.tax_status === 'GRAVADO'
                  ? `${l.tax_rate}%`
                  : l.tax_status === 'EXENTO'
                    ? 'Exento (0%)'
                    : 'Excluido'}
              </td>
              <td className="num">{formatCOP(l.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="totals">
        <dl>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatCOP(invoice.subtotal_cents)}</dd>
          </div>
          {invoice.discount_cents > 0 && (
            <div>
              <dt>Descuento</dt>
              <dd>−{formatCOP(invoice.discount_cents)}</dd>
            </div>
          )}
          <div>
            <dt>IVA</dt>
            <dd>{formatCOP(invoice.tax_cents)}</dd>
          </div>
          <div className="grand">
            <dt>Total</dt>
            <dd>{formatCOP(invoice.total_cents)}</dd>
          </div>
        </dl>
      </section>

      <footer className="doc-footer">
        <div className="fiscal-meta">
          {range?.resolution_number ? (
            <p>
              Resolución DIAN {range.resolution_number}
              {range.resolution_date ? ` de ${range.resolution_date}` : ''} · Prefijo{' '}
              {range.prefix} · Rango {range.range_from}–{range.range_to}
              {range.valid_until ? ` · Vigente hasta ${range.valid_until}` : ''}
            </p>
          ) : (
            <p>
              Numeración de prueba {range?.prefix ?? ''} {range?.range_from ?? ''}–
              {range?.range_to ?? ''} — documento SIN validez fiscal.
            </p>
          )}
          {cufe && (
            <p className="cufe">
              CUFE: <span>{cufe}</span>
            </p>
          )}
          <p className="brand">Generado con Tuvetia</p>
        </div>
        {qrSvg && <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} aria-hidden />}
      </footer>
    </article>
  );
}

export const INVOICE_DOC_STYLES = `
  :root {
    --ink: #171717;
    --ink-soft: #555;
    --ink-faint: #8a8a8a;
    --line: #d9d9d9;
    --brand: #2563eb;
  }
  html, body {
    background: #f3f3f3;
    margin: 0;
    padding: 0;
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11pt;
    line-height: 1.45;
  }
  .doc-root { max-width: 760px; margin: 0 auto; padding: 2rem 1rem; }

  .print-toolbar {
    margin-bottom: 1.5rem; padding: 1rem; background: white;
    border: 1px solid var(--line); border-radius: 0.5rem;
    display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  }
  .print-button {
    background: var(--brand); color: white; border: none;
    padding: 0.6rem 1rem; border-radius: 0.375rem;
    font-size: 0.9rem; font-weight: 500; cursor: pointer;
  }
  .print-button:hover { opacity: 0.9; }
  .print-toolbar-help { margin: 0; color: var(--ink-soft); font-size: 0.85rem; }

  .public-note {
    margin-bottom: 1.5rem; padding: 0.9rem 1rem; background: white;
    border: 1px solid var(--line); border-radius: 0.5rem;
    color: var(--ink-soft); font-size: 0.85rem;
  }
  .public-note p { margin: 0 0 0.25rem; }
  .public-note p:last-child { margin: 0; }

  .doc {
    position: relative; overflow: hidden;
    background: white; padding: 2.5rem 3rem;
    border: 1px solid var(--line); border-radius: 0.25rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .watermark {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 3rem; font-weight: 800; letter-spacing: 0.15em;
    color: rgba(180, 83, 9, 0.10); transform: rotate(-24deg);
    pointer-events: none; user-select: none; white-space: nowrap;
  }

  .doc-header {
    display: flex; justify-content: space-between; gap: 2rem;
    border-bottom: 2px solid var(--ink); padding-bottom: 1rem; margin-bottom: 1.25rem;
  }
  .emitter-name { margin: 0; font-size: 1.25rem; font-weight: 700; }
  .emitter-meta { margin: 0.15rem 0 0; font-size: 0.85rem; color: var(--ink-soft); }
  .doc-id { text-align: right; }
  .doc-kind { margin: 0; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-faint); }
  .doc-number { margin: 0.15rem 0 0; font-size: 1.3rem; font-weight: 700; }
  .doc-date { margin: 0.15rem 0 0; font-size: 0.85rem; color: var(--ink-soft); }

  .section-title { margin: 0 0 0.3rem; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-faint); }
  .buyer { margin-bottom: 1.25rem; }
  .buyer p { margin: 0; }
  .buyer .soft { color: var(--ink-soft); font-size: 0.9rem; }

  .lines { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  .lines th {
    text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--ink-faint); border-bottom: 1px solid var(--line); padding: 0.4rem 0.5rem;
  }
  .lines td { border-bottom: 1px solid #eee; padding: 0.45rem 0.5rem; vertical-align: top; }
  .lines .num { text-align: right; white-space: nowrap; }

  .totals { display: flex; justify-content: flex-end; margin-top: 0.75rem; }
  .totals dl { margin: 0; min-width: 240px; }
  .totals dl div { display: flex; justify-content: space-between; gap: 2rem; padding: 0.15rem 0.5rem; }
  .totals dt { color: var(--ink-soft); }
  .totals dd { margin: 0; }
  .totals .grand { border-top: 2px solid var(--ink); margin-top: 0.3rem; padding-top: 0.4rem; font-weight: 700; font-size: 1.05rem; }

  .doc-footer {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 2rem;
    margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line);
  }
  .fiscal-meta { font-size: 0.75rem; color: var(--ink-faint); }
  .fiscal-meta p { margin: 0 0 0.25rem; }
  .cufe span { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; word-break: break-all; }
  .brand { font-weight: 600; letter-spacing: 0.04em; color: var(--ink-soft); }
  .qr { flex-shrink: 0; width: 96px; height: 96px; }
  .qr svg { width: 96px; height: 96px; }

  @media print {
    html, body { background: white; font-size: 10pt; }
    .doc-root { max-width: none; padding: 0; }
    .doc { border: none; box-shadow: none; padding: 0; }
    .no-print { display: none !important; }
    @page { size: A4; margin: 18mm 18mm; }
    .lines tr, .totals, .doc-footer { page-break-inside: avoid; }
  }
`;

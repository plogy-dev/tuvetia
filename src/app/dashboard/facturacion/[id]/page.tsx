import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FlaskConical, PawPrint, Stethoscope } from 'lucide-react';
import { getAppBaseUrl } from '@/lib/base-url';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import { getInvoiceDetail } from '@/lib/facturacion/queries';
import { formatCOP, fmtDate, fmtDateTime } from '@/lib/facturacion/format';
import {
  CollectionBadge,
  DeliveryBadge,
  FiscalBadge,
  FollowupBadge,
  LifecycleBadge,
} from '@/components/facturacion/badges';
import { getBillingSettings } from '@/lib/facturacion/queries';
import { InvoiceActionsPanel } from '@/components/facturacion/InvoiceActionsPanel';
import { FollowupActions } from '@/components/cartera/FollowupActions';
import { getInvoiceCommMessages } from '@/lib/cartera/queries';
import type { InvoiceEventType } from '@/lib/facturacion/domain/types';

export const dynamic = 'force-dynamic';

const EVENT_LABELS: Record<InvoiceEventType, string> = {
  CREATED: 'Borrador creado',
  ISSUED: 'Emitida',
  FISCAL_SUBMITTED: 'Transmitida al proveedor fiscal',
  FISCAL_VALIDATED: 'Validada (CUFE asignado)',
  FISCAL_REJECTED: 'Rechazada por el proveedor',
  QUEUED: 'Mensaje en cola de envío',
  SENT: 'Enviada al cliente',
  DELIVERED: 'Entregada',
  DELIVERY_FAILED: 'Falló la entrega',
  PAYMENT_APPLIED: 'Pago aplicado',
  DISPUTE_OPENED: 'Disputa abierta',
  DISPUTE_CLOSED: 'Disputa cerrada',
  CREDIT_NOTE_APPLIED: 'Nota crédito aplicada',
  WRITTEN_OFF: 'Castigada',
  REMINDERS_PAUSED: 'Recordatorios pausados',
  REMINDERS_RESUMED: 'Recordatorios reanudados',
  PROMISE_TO_PAY: 'Promesa de pago',
  REMINDER_SENT: 'Recordatorio enviado',
  PROMISE_EXPIRED: 'Promesa vencida',
  HUMAN_TASK_OPENED: 'Caso escalado a una persona',
  HUMAN_TASK_RESOLVED: 'Caso resuelto',
  CHANNEL_REVOKED: 'Canal revocado por el cliente',
};

export default async function FacturaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const [detail, settings, commMessages] = await Promise.all([
    getInvoiceDetail(supabase, clinicId, id),
    getBillingSettings(supabase, clinicId),
    getInvoiceCommMessages(supabase, clinicId, id),
  ]);
  if (!detail) notFound();
  const { invoice, lines, events, payer, fiscalDocuments } = detail;

  // Contexto CRM: paciente facturado y consulta de origen (chat de Athos).
  const [patientRes, consultationRes] = await Promise.all([
    invoice.patient_id
      ? supabase
          .from('patients')
          .select('id, name')
          .eq('id', invoice.patient_id)
          .maybeSingle<{ id: string; name: string }>()
      : Promise.resolve({ data: null }),
    invoice.consultation_id
      ? supabase
          .from('consultations')
          .select('chat_id')
          .eq('id', invoice.consultation_id)
          .maybeSingle<{ chat_id: string | null }>()
      : Promise.resolve({ data: null }),
  ]);
  const patient = patientRes.data;
  const consultationChatId = consultationRes.data?.chat_id ?? null;

  const shareUrl = invoice.share_token ? `${getAppBaseUrl()}/f/${invoice.share_token}` : null;

  // Timeline omnicanal: eventos de la factura + mensajes de cartera, ordenados.
  type TimelineItem = { at: string; label: string; detail?: string };
  const timeline: TimelineItem[] = [
    ...events.map((e) => ({
      at: e.created_at,
      label: EVENT_LABELS[e.event_type] ?? e.event_type,
      detail:
        e.event_type === 'PAYMENT_APPLIED' && typeof e.payload?.amountCents === 'number'
          ? formatCOP(e.payload.amountCents as number)
          : undefined,
    })),
    ...commMessages.map((m) => ({
      at: m.created_at,
      label: `${m.direction === 'SALIENTE' ? '→' : '←'} ${m.channel === 'WHATSAPP' ? 'WhatsApp' : 'Correo'}: ${m.template ?? 'mensaje'}`,
      detail: m.status.toLowerCase(),
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const fiscalDoc = fiscalDocuments[fiscalDocuments.length - 1] ?? null;
  const isSandbox = fiscalDoc?.provider === 'SANDBOX';

  return (
    <main className="flex-1 min-w-0">
      <div className="mx-auto w-full max-w-4xl px-8 py-10">
        <header className="mb-6">
          <Link
            href="/dashboard/facturacion"
            className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Facturación
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">
              {invoice.full_number ??
                `Borrador · ${invoice.doc_kind === 'POS' ? 'POS' : 'Factura de venta'}`}
            </h1>
            <LifecycleBadge status={invoice.status} />
            {isSandbox && (
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted">
                <FlaskConical className="size-3" aria-hidden />
                sandbox
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <FiscalBadge status={invoice.fiscal_status} />
            {invoice.status === 'EMITIDA' && (
              <>
                <CollectionBadge status={invoice.collection_status} />
                <DeliveryBadge status={invoice.delivery_status} />
                <FollowupBadge status={invoice.followup_status} />
              </>
            )}
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="space-y-5">
            {/* Cliente */}
            <section className="rounded-xl border border-line bg-surface p-4 text-sm">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-faint">
                Cliente
              </h2>
              {payer ? (
                <>
                  <p className="font-medium text-fg">{payer.name}</p>
                  <p className="text-fg-muted">
                    {payer.doc_type} {payer.doc_number}
                    {payer.email ? ` · ${payer.email}` : ''}
                    {payer.phone ? ` · ${payer.phone}` : ''}
                  </p>
                </>
              ) : (
                <p className="text-fg-faint">Sin responsable de pago.</p>
              )}
            </section>

            {/* Líneas */}
            <section className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-fg-faint">
                    <th className="px-4 py-2 font-medium">Descripción</th>
                    <th className="px-2 py-2 text-right font-medium">Cant.</th>
                    <th className="px-2 py-2 text-right font-medium">Precio</th>
                    <th className="px-2 py-2 text-right font-medium">IVA</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2 text-fg">{l.description}</td>
                      <td className="px-2 py-2 text-right text-fg-muted">
                        {l.qty} {l.unit !== 'unidad' ? l.unit : ''}
                      </td>
                      <td className="px-2 py-2 text-right text-fg-muted">
                        {formatCOP(l.unit_price_cents)}
                      </td>
                      <td className="px-2 py-2 text-right text-fg-muted">
                        {l.tax_status === 'GRAVADO' ? `${l.tax_rate}%` : 'Excl.'}
                      </td>
                      <td className="px-4 py-2 text-right text-fg">{formatCOP(l.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line text-sm">
                    <td colSpan={4} className="px-4 py-2 text-right text-fg-muted">
                      Subtotal
                    </td>
                    <td className="px-4 py-2 text-right text-fg">
                      {formatCOP(invoice.subtotal_cents)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-4 py-1 text-right text-fg-muted">
                      IVA
                    </td>
                    <td className="px-4 py-1 text-right text-fg">{formatCOP(invoice.tax_cents)}</td>
                  </tr>
                  <tr className="text-base font-semibold">
                    <td colSpan={4} className="px-4 py-2 text-right text-fg">
                      Total
                    </td>
                    <td className="px-4 py-2 text-right text-fg">
                      {formatCOP(invoice.total_cents)}
                    </td>
                  </tr>
                  {invoice.status === 'EMITIDA' && (
                    <tr className="text-sm">
                      <td colSpan={4} className="px-4 pb-3 text-right text-fg-muted">
                        Saldo
                      </td>
                      <td className="px-4 pb-3 text-right text-fg">
                        {formatCOP(invoice.balance_cents)}
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </section>

            {/* Info fiscal */}
            {fiscalDoc && (
              <section className="rounded-xl border border-line bg-surface p-4 text-sm">
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-faint">
                  Documento fiscal
                </h2>
                <dl className="grid gap-1.5 sm:grid-cols-[110px_1fr]">
                  <dt className="text-fg-faint">Proveedor</dt>
                  <dd className="text-fg-muted">
                    {fiscalDoc.provider}
                    {isSandbox ? ' (pruebas — sin validez fiscal)' : ''}
                  </dd>
                  <dt className="text-fg-faint">Estado</dt>
                  <dd className="text-fg-muted">{fiscalDoc.status}</dd>
                  {fiscalDoc.cufe && (
                    <>
                      <dt className="text-fg-faint">CUFE</dt>
                      <dd className="break-all font-mono text-xs text-fg-muted">
                        {fiscalDoc.cufe}
                      </dd>
                    </>
                  )}
                  {fiscalDoc.last_error && (
                    <>
                      <dt className="text-fg-faint">Último error</dt>
                      <dd className="text-warn">{fiscalDoc.last_error}</dd>
                    </>
                  )}
                </dl>
              </section>
            )}

            {/* Timeline omnicanal: eventos + comunicaciones de cartera */}
            <section className="rounded-xl border border-line bg-surface p-4">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-faint">
                Historial
              </h2>
              <ol className="space-y-2 text-sm" data-testid="invoice-timeline">
                {timeline.map((t, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3">
                    <span className="text-fg-muted">
                      {t.label}
                      {t.detail ? ` · ${t.detail}` : ''}
                    </span>
                    <span className="shrink-0 text-xs text-fg-faint">{fmtDateTime(t.at)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          {/* Columna lateral */}
          <div className="space-y-4">
            <InvoiceActionsPanel
              invoiceId={invoice.id}
              status={invoice.status}
              totalCents={invoice.total_cents}
              balanceCents={invoice.balance_cents}
              payerEmail={payer?.email ?? null}
              payerPhone={payer?.phone ?? null}
              payerName={payer?.name ?? null}
              fullNumber={invoice.full_number}
              shareUrl={shareUrl}
              deliveryStatus={invoice.delivery_status}
              defaultTermsDays={settings?.default_payment_terms_days ?? 15}
              reminderChannel={settings?.reminder_channel ?? 'WHATSAPP'}
              remindersEnabled={settings?.reminders_enabled ?? false}
            />
            {invoice.status === 'EMITIDA' && invoice.balance_cents > 0 && (
              <FollowupActions
                invoiceId={invoice.id}
                remindersPaused={invoice.reminders_paused}
                inDispute={invoice.collection_status === 'EN_DISPUTA'}
              />
            )}
            <div className="rounded-xl border border-line bg-surface p-4 text-sm">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-faint">
                Datos
              </h2>
              <dl className="space-y-1 text-fg-muted">
                <div className="flex justify-between">
                  <dt className="text-fg-faint">Tipo</dt>
                  <dd>{invoice.doc_kind === 'POS' ? 'POS electrónico' : 'Factura de venta'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-faint">Creada</dt>
                  <dd>{fmtDate(invoice.created_at)}</dd>
                </div>
                {invoice.issued_at && (
                  <div className="flex justify-between">
                    <dt className="text-fg-faint">Emitida</dt>
                    <dd>{fmtDateTime(invoice.issued_at)}</dd>
                  </div>
                )}
                {invoice.due_date && (
                  <div className="flex justify-between">
                    <dt className="text-fg-faint">Vence</dt>
                    <dd>{fmtDate(invoice.due_date)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-fg-faint">Pago</dt>
                  <dd>{invoice.payment_terms === 'CREDIT' ? 'Crédito' : 'Inmediato'}</dd>
                </div>
              </dl>
              {(patient || consultationChatId) && (
                <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
                  {patient && (
                    <Link
                      href={`/app/crm/${patient.id}/facturacion`}
                      className="inline-flex items-center gap-1.5 text-sm text-brand underline-offset-2 hover:underline"
                    >
                      <PawPrint className="size-3.5" aria-hidden />
                      Ver ficha de {patient.name}
                    </Link>
                  )}
                  {consultationChatId && (
                    <Link
                      href={`/app/athos/${consultationChatId}`}
                      className="inline-flex items-center gap-1.5 text-sm text-brand underline-offset-2 hover:underline"
                    >
                      <Stethoscope className="size-3.5" aria-hidden />
                      Ver la consulta de origen
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

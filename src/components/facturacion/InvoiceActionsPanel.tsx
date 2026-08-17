'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Mail, MessageCircle, Printer } from 'lucide-react';
import {
  discardInvoiceDraft,
  issueInvoiceAction,
  registerManualPaymentAction,
  sendInvoiceEmailAction,
} from '@/lib/facturacion/actions';
import { formatCOP } from '@/lib/facturacion/domain/money';
import {
  makeDefaultPlan,
  PaymentSection,
  planToActionFields,
  validatePlan,
  type PaymentPlan,
} from './PaymentSection';

/**
 * Acciones de la factura según su estado:
 *   BORRADOR → emitir (declarando la realidad del pago, F1) o descartar.
 *   EMITIDA  → registrar pago manual, imprimir.
 */
export function InvoiceActionsPanel({
  invoiceId,
  status,
  totalCents,
  balanceCents,
  payerEmail,
  payerPhone,
  payerName,
  fullNumber,
  shareUrl,
  deliveryStatus,
  defaultTermsDays = 15,
  reminderChannel = 'WHATSAPP',
  remindersEnabled = false,
}: {
  invoiceId: string;
  status: string;
  totalCents: number;
  balanceCents: number;
  payerEmail?: string | null;
  payerPhone?: string | null;
  payerName?: string | null;
  fullNumber?: string | null;
  /** Link público /f/<token> de la factura (para compartir por WhatsApp). */
  shareUrl?: string | null;
  deliveryStatus?: string;
  defaultTermsDays?: number;
  reminderChannel?: 'WHATSAPP' | 'EMAIL';
  remindersEnabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [plan, setPlan] = useState<PaymentPlan>(() => makeDefaultPlan(defaultTermsDays));
  const [payMethod, setPayMethod] = useState<'EFECTIVO' | 'TRANSFERENCIA'>('EFECTIVO');
  const [payAmount, setPayAmount] = useState(''); // en pesos

  // wa.me: normaliza el teléfono a dígitos; celular colombiano sin indicativo → +57.
  function waHref(): string {
    const digitsRaw = (payerPhone ?? '').replace(/\D/g, '');
    const digits =
      digitsRaw.length === 10 && digitsRaw.startsWith('3') ? `57${digitsRaw}` : digitsRaw;
    const saludo = payerName ? `Hola ${payerName.split(' ')[0]}, ` : 'Hola, ';
    const doc = fullNumber ? `tu factura ${fullNumber}` : 'tu factura';
    const monto = ` por ${formatCOP(totalCents)}`;
    const link = shareUrl ? `\n\nPuedes verla aquí: ${shareUrl}` : '';
    const text = encodeURIComponent(`${saludo}te comparto ${doc}${monto}.${link}`);
    return digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string; msg?: string }>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? 'Error inesperado');
        return;
      }
      if (r.msg) setNotice(r.msg);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-medium text-fg">Acciones</h2>

      {status === 'BORRADOR' && (
        <>
          <PaymentSection
            plan={plan}
            onChange={setPlan}
            totalCents={totalCents}
            defaultTermsDays={defaultTermsDays}
            reminderChannel={reminderChannel}
            remindersEnabled={remindersEnabled}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                run(async () => {
                  const planError = validatePlan(plan, totalCents);
                  if (planError) return { ok: false, error: planError };
                  const fields = planToActionFields(plan);
                  const r = await issueInvoiceAction({
                    invoiceId,
                    outcome: fields.outcome,
                    method: fields.method,
                    amountCents: fields.amountCents,
                    reference: fields.reference,
                    dueDate: fields.dueDate,
                    followupEnabled: fields.followupEnabled,
                  });
                  return r.ok
                    ? { ok: true, msg: `Emitida como ${r.result.fullNumber}` }
                    : { ok: false, error: r.error };
                })
              }
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
            >
              {isPending ? 'Emitiendo…' : 'Emitir'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (!window.confirm('¿Descartar este borrador? No se puede deshacer.')) return;
                run(async () => {
                  const r = await discardInvoiceDraft({ invoiceId });
                  if (r.ok) {
                    router.push('/dashboard/facturacion');
                    return { ok: true };
                  }
                  return { ok: false, error: r.error };
                });
              }}
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-warn transition disabled:opacity-60"
            >
              Descartar borrador
            </button>
          </div>
          <p className="text-xs text-fg-faint">
            Emitir asigna consecutivo y transmite el documento. Una factura emitida
            solo se corrige con nota crédito.
          </p>
        </>
      )}

      {status === 'EMITIDA' && (
        <>
          {balanceCents > 0 ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-fg-muted">
                Registrar pago (saldo {formatCOP(balanceCents)})
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as 'EFECTIVO' | 'TRANSFERENCIA')}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                </select>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder={`${(balanceCents / 100).toFixed(0)}`}
                  className="w-32 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    run(async () => {
                      const pesos = Number(payAmount || balanceCents / 100);
                      if (!Number.isFinite(pesos) || pesos <= 0) {
                        return { ok: false, error: 'Monto inválido.' };
                      }
                      const r = await registerManualPaymentAction({
                        invoiceId,
                        method: payMethod,
                        amountCents: Math.round(pesos * 100),
                      });
                      return r.ok
                        ? {
                            ok: true,
                            msg: r.fullyPaid
                              ? 'Pago registrado — factura PAGADA'
                              : `Pago registrado — saldo ${formatCOP(r.newBalanceCents)}`,
                          }
                        : { ok: false, error: r.error };
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition disabled:opacity-60"
                >
                  {isPending ? 'Registrando…' : 'Registrar pago'}
                </button>
              </div>
              <p className="text-xs text-fg-faint">
                Vacío = pagar el saldo completo. El sistema rechaza sobrepagos.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ok">Factura pagada en su totalidad.</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                const dest = payerEmail ?? window.prompt('Email del cliente:') ?? '';
                if (!dest) return;
                run(async () => {
                  const r = await sendInvoiceEmailAction({
                    invoiceId,
                    to: payerEmail ? null : dest,
                  });
                  return r.ok
                    ? { ok: true, msg: `Enviada a ${r.to}` }
                    : { ok: false, error: r.error };
                });
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition disabled:opacity-60"
            >
              <Mail className="size-4" aria-hidden />
              {deliveryStatus === 'NO_ENVIADA' ? 'Enviar por email' : 'Reenviar por email'}
            </button>
            <a
              href={waHref()}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-ok/50 bg-surface px-4 py-2 text-sm font-medium text-ok hover:bg-surface-2 transition"
            >
              <MessageCircle className="size-4" aria-hidden />
              Enviar por WhatsApp
            </a>
            <a
              href={`/dashboard/facturacion/${invoiceId}/imprimir`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition"
            >
              <Printer className="size-4" aria-hidden />
              Imprimir / PDF
            </a>
          </div>
        </>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-warn bg-surface-2 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {notice && (
        <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ok">
          <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {notice}
        </p>
      )}
    </div>
  );
}

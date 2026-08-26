'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Ban, Check, Mail, MessageCircle, Printer } from 'lucide-react';
import {
  anularFacturaAction,
  discardInvoiceDraft,
  issueInvoiceAction,
  registerManualPaymentAction,
  sendInvoiceEmailAction,
} from '@/lib/facturacion/actions';
import { MOTIVOS_NOTA_CREDITO } from '@/lib/facturacion/credit-notes';
import { formatCOP, pesosToCents } from '@/lib/facturacion/domain/money';
import {
  makeDefaultPlan,
  PaymentSection,
  planToActionFields,
  validatePlan,
  type PaymentPlan,
} from './PaymentSection';
import { InputMoneda } from '@/components/ui/input-moneda';
import { textoDesdePesos } from '@/lib/moneda';

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
  creditedCents = 0,
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
  /**
   * Lo ya acreditado por notas crédito anteriores. Sin este dato el panel no puede decir la verdad:
   * el servidor acredita `total - ya acreditado`, y la pantalla anunciaba el total entero.
   */
  creditedCents?: number;
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
  // Anulación: la caja se abre con un clic y pide motivo. NO se anula desde el primer clic —
  // una nota crédito quema un consecutivo fiscal y no se deshace.
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState<string>('ANULACION');
  const [detalle, setDetalle] = useState('');
  // "todo" = anular · "parte" = nota crédito parcial. Arranca en "todo" porque es el caso que el
  // vet busca cuando llega acá: se equivocó y quiere deshacer.
  const [alcance, setAlcance] = useState<'todo' | 'parte'>('todo');
  const [montoPesos, setMontoPesos] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  // Lo que el servidor va a acreditar de verdad: `anularFactura` calcula `total - ya acreditado`.
  // La pantalla anunciaba el total entero, así que después de una parcial prometía un importe que
  // no iba a emitir — y si el vet lo escribía en el campo, el servidor se lo rechazaba.
  const acreditableCents = Math.max(0, totalCents - creditedCents);

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

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; msg?: string }>,
    alExito?: () => void,
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? 'Error inesperado');
        return;
      }
      if (r.msg) setNotice(r.msg);
      alExito?.();
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
                <InputMoneda
                  aria-label="Monto del pago en pesos"
                  value={payAmount === '' ? null : Number(payAmount)}
                  onValueChange={(pesos) => setPayAmount(pesos === null ? '' : String(pesos))}
                  placeholder={textoDesdePesos(Math.trunc(balanceCents / 100))}
                  className="w-36"
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

          {/* ── Anular con nota crédito ──────────────────────────────────────────────────────
              Es la ÚNICA forma de corregir una factura emitida, y hasta el 23-ago no existía: la
              línea de arriba de esta misma pantalla ya prometía "solo se corrige con nota crédito".

              Va detrás de un clic y pide motivo a propósito. Una nota crédito quema un consecutivo
              fiscal propio y no se deshace: si fuera un botón suelto al lado de "Imprimir", se
              apretaría por error. */}
          <div className="border-t border-line pt-3">
            {!anulando ? (
              <button
                type="button"
                onClick={() => setAnulando(true)}
                className="inline-flex items-center gap-2 text-xs text-fg-faint hover:text-warn transition"
              >
                <Ban className="size-3.5" aria-hidden />
                Anular con nota crédito
              </button>
            ) : (
              <div className="space-y-3 rounded-lg border border-warn/40 bg-surface-2 p-3">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAlcance('todo')}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${alcance === 'todo' ? 'border-warn bg-surface text-warn' : 'border-line text-fg-muted hover:bg-surface'}`}
                  >
                    Anular toda la factura
                  </button>
                  <button
                    type="button"
                    onClick={() => setAlcance('parte')}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${alcance === 'parte' ? 'border-warn bg-surface text-warn' : 'border-line text-fg-muted hover:bg-surface'}`}
                  >
                    Acreditar una parte
                  </button>
                </div>

                {alcance === 'todo' ? (
                  <p className="text-xs text-fg-muted">
                    Se emite una <b className="text-fg">nota crédito</b> por{' '}
                    <b className="text-fg">{formatCOP(acreditableCents)}</b> que anula{' '}
                    {fullNumber ?? 'esta factura'}.
                    {creditedCents > 0 && (
                      <> Ya se acreditaron <b className="text-fg">{formatCOP(creditedCents)}</b> antes.</>
                    )}
                    Consume un consecutivo propio y <b className="text-fg">no se puede deshacer</b>.
                    {balanceCents === 0 && (
                      <> El pago ya recibido <b className="text-fg">no se borra</b>: queda como saldo a favor del cliente.</>
                    )}
                  </p>
                ) : (
                  <>
                    <div>
                      <label htmlFor="nc-monto" className="block text-xs font-medium text-fg-muted">
                        Cuánto acreditar (pesos)
                      </label>
                      <input
                        id="nc-monto"
                        inputMode="numeric"
                        value={montoPesos}
                        onChange={(e) => setMontoPesos(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder={String(Math.round(acreditableCents / 100))}
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
                      />
                    </div>
                    {/* LO QUE NO HACE, dicho ANTES de emitir. Una parcial ajusta plata, no stock: sin
                        saber qué línea se acredita no hay forma de saber qué volvió, y devolver
                        inventario adivinando pondría unidades que siguen en la casa del cliente. */}
                    <p className="text-xs text-fg-muted">
                      La factura <b className="text-fg">sigue vigente</b> con menos saldo, y{' '}
                      <b className="text-fg">no se devuelve inventario</b>. Si el cliente devolvió un
                      producto, registrá la devolución en Inventario.
                    </p>
                  </>
                )}

                <div>
                  <label htmlFor="nc-motivo" className="block text-xs font-medium text-fg-muted">
                    Motivo (DIAN)
                  </label>
                  <select
                    id="nc-motivo"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
                  >
                    {Object.entries(MOTIVOS_NOTA_CREDITO).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="nc-detalle" className="block text-xs font-medium text-fg-muted">
                    Detalle (opcional)
                  </label>
                  <input
                    id="nc-detalle"
                    value={detalle}
                    onChange={(e) => setDetalle(e.target.value)}
                    maxLength={500}
                    placeholder="Qué pasó, en una línea"
                    className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isPending || (alcance === 'parte' && !Number(montoPesos))}
                    onClick={() =>
                      run(async () => {
                        const r = await anularFacturaAction({
                          invoiceId,
                          motivo,
                          detalle,
                          montoCents: alcance === 'parte' ? pesosToCents(Number(montoPesos)) : null,
                        });
                        return r.ok
                          ? {
                              ok: true,
                              msg: r.anulada
                                ? `Nota crédito ${r.fullNumber}: factura anulada`
                                : `Nota crédito ${r.fullNumber} por ${formatCOP(r.totalCents)} — quedan ${formatCOP(r.acreditableRestante)} acreditables`,
                            }
                          : { ok: false, error: r.error };
                      },
                      // SE CIERRA EL FORMULARIO AL EMITIR, y no es cosmético. Una PARCIAL deja la
                      // factura EMITIDA, así que todo este bloque se vuelve a pintar con la caja
                      // abierta, el monto escrito y el botón habilitado: un segundo clic —de
                      // alguien que no vio el aviso— emitía otra nota crédito, quemaba otro
                      // consecutivo DIAN y acreditaba de más. El servidor ya no puede frenarlo: la
                      // guarda de "esta factura ya tiene una nota" se fue con las parciales.
                      () => {
                        setAnulando(false);
                        setMontoPesos('');
                        setAlcance('todo');
                        setDetalle('');
                      },
                    )
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-warn bg-surface px-4 py-2 text-sm font-medium text-warn hover:bg-surface-2 transition disabled:opacity-60"
                  >
                    <Ban className="size-4" aria-hidden />
                    {alcance === 'todo' ? 'Anular la factura' : 'Emitir la nota crédito'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnulando(false)}
                    className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
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

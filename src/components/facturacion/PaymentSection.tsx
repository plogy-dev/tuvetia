'use client';

// Sección «Forma de pago» de la emisión (F1 del plan de recaudo).
// Reemplaza el binario IMMEDIATE/CREDIT por la realidad colombiana:
//   1. Pagado ahora   — el dinero ya está en la mano.
//   2. Pendiente de pago — «Gracias doctor, le transfiero en estos días».
//   3. Abono parcial  — pagó una parte y el saldo queda en cartera.
// Muestra SIEMPRE el saldo que quedará pendiente y qué hará el sistema
// (primer recordatorio estimado bajo Ley 2300) antes de confirmar.

import { useMemo } from 'react';
import { CalendarClock, HandCoins, MessageCircle, Wallet } from 'lucide-react';
import { formatCOP } from '@/lib/facturacion/domain/money';
import { holidaySet } from '@/lib/facturacion/domain/holidays';
import { nextAllowedTime } from '@/lib/facturacion/domain/reminders';
import type { PaymentOutcome } from '@/lib/facturacion/domain/types';
import type { PaymentTerms } from '@/lib/supabase/types';

export type PaymentPlan = {
  outcome: PaymentOutcome;
  method: 'EFECTIVO' | 'TRANSFERENCIA';
  reference: string;
  /** Monto del abono en PESOS (input del vet; se convierte a centavos al enviar). */
  amountPesos: string;
  dueDate: string; // YYYY-MM-DD
  followupEnabled: boolean;
};

export function defaultDueDate(termsDays: number, from = new Date()): string {
  // Día de BOGOTÁ (UTC-5 fijo, sin DST), no del proceso. Antes se sumaba en hora local y se
  // serializaba a UTC: en Vercel (UTC) una factura emitida después de las 19:00 de Bogotá vencía
  // un día tarde, y como esto corre en el render del servidor Y en la hidratación, dos TZ
  // distintas producían un hydration mismatch en el <input type="date">. Mismo criterio que
  // dateKeyBogota en finanzas.
  const bogota = new Date(from.getTime() - 5 * 3_600_000);
  bogota.setUTCDate(bogota.getUTCDate() + termsDays);
  return bogota.toISOString().slice(0, 10);
}

/**
 * El plan con el que abre la emisión.
 *
 * ── `terminos` NO ES DECORATIVO: SIN ÉL, EL CARRITO MENTÍA ────────────────────────────────────
 *
 * El carrito tiene un select rotulado «Forma de pago» con Contado / Crédito
 * (`InvoiceCart.tsx`), y esta pantalla tiene OTRO control con el MISMO rótulo —«Forma de pago»,
 * Pagado ahora / Pendiente / Abono parcial—. Hasta el 27-ago el segundo ignoraba al primero: esta
 * función arrancaba siempre en `PAGADO_AHORA`, y al emitir el servidor sobrescribe
 * `payment_terms` según el resultado elegido acá (`invoices.ts`).
 *
 * O sea que elegir «Crédito» en el carrito y no tocar nada en la emisión emitía la factura COMO
 * PAGADA. El control existía, se podía cambiar, y no hacía absolutamente nada — que es peor que no
 * tenerlo, porque el vet cree que ya lo dijo.
 *
 * Con `terminos`, «Crédito» abre la emisión en «Pendiente de pago» con su fecha de vencimiento. No
 * decide por el vet —los tres botones siguen ahí y puede cambiarlos— pero deja de contradecirlo.
 */
export function makeDefaultPlan(
  termsDays: number,
  terminos: PaymentTerms = 'IMMEDIATE',
): PaymentPlan {
  return {
    outcome: terminos === 'CREDIT' ? 'PENDIENTE' : 'PAGADO_AHORA',
    method: 'EFECTIVO',
    reference: '',
    amountPesos: '',
    dueDate: defaultDueDate(termsDays),
    followupEnabled: true,
  };
}

export function planAmountCents(plan: PaymentPlan): number {
  const pesos = Number(plan.amountPesos.replace(/[.\s]/g, '').replace(',', '.'));
  return Number.isFinite(pesos) ? Math.round(pesos * 100) : 0;
}

/** Validación de UI previa al submit (el server re-valida con el dominio). */
export function validatePlan(plan: PaymentPlan, totalCents: number): string | null {
  if (plan.outcome === 'ABONO_PARCIAL') {
    const cents = planAmountCents(plan);
    if (cents <= 0) return 'Indica el valor del abono.';
    if (cents >= totalCents) {
      return 'El abono debe ser menor que el total — si pagó todo, usa «Pagado ahora».';
    }
  }
  if (plan.outcome !== 'PAGADO_AHORA' && !plan.dueDate) {
    return 'El saldo pendiente necesita fecha de vencimiento.';
  }
  return null;
}

/**
 * Campos que la action de emisión espera (issueInvoiceAction). El saldo NO se
 * envía: el servidor lo recalcula con el dominio a partir del total y el abono.
 */
export function planToActionFields(plan: PaymentPlan) {
  return {
    outcome: plan.outcome,
    method: plan.outcome === 'PENDIENTE' ? undefined : plan.method,
    amountCents: plan.outcome === 'ABONO_PARCIAL' ? planAmountCents(plan) : undefined,
    reference: plan.reference.trim() || undefined,
    dueDate: plan.outcome === 'PAGADO_AHORA' ? undefined : plan.dueDate,
    followupEnabled: plan.followupEnabled,
  };
}

/** Primer contacto permitido por la Ley 2300 a partir del vencimiento. */
function estimateFirstReminder(dueDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  // Offset explícito: sin él, el instante depende de la TZ del proceso (servidor UTC vs navegador).
  const due = new Date(`${dueDate}T09:00:00-05:00`);
  if (Number.isNaN(due.getTime())) return null;
  const holidays = holidaySet([due.getFullYear(), due.getFullYear() + 1]);
  return nextAllowedTime(due, holidays);
}

const OPTIONS: {
  value: PaymentOutcome;
  label: string;
  hint: string;
  Icon: typeof Wallet;
}[] = [
  { value: 'PAGADO_AHORA', label: 'Pagado ahora', hint: 'El dinero ya fue recibido', Icon: Wallet },
  {
    value: 'PENDIENTE',
    label: 'Pendiente de pago',
    hint: '«Le transfiero en estos días»',
    Icon: CalendarClock,
  },
  {
    value: 'ABONO_PARCIAL',
    label: 'Abono parcial',
    hint: 'Pagó una parte, queda saldo',
    Icon: HandCoins,
  },
];

export function PaymentSection({
  plan,
  onChange,
  totalCents,
  defaultTermsDays,
  reminderChannel,
  remindersEnabled,
}: {
  plan: PaymentPlan;
  onChange: (plan: PaymentPlan) => void;
  totalCents: number;
  defaultTermsDays: number;
  reminderChannel: 'WHATSAPP' | 'EMAIL';
  remindersEnabled: boolean;
}) {
  const set = (patch: Partial<PaymentPlan>) => onChange({ ...plan, ...patch });

  const balanceCents =
    plan.outcome === 'PAGADO_AHORA'
      ? 0
      : plan.outcome === 'ABONO_PARCIAL'
        ? Math.max(0, totalCents - planAmountCents(plan))
        : totalCents;

  const followupActive = remindersEnabled && plan.followupEnabled && balanceCents > 0;
  const firstReminder = useMemo(
    () => (followupActive ? estimateFirstReminder(plan.dueDate) : null),
    [followupActive, plan.dueDate],
  );

  const channelLabel = reminderChannel === 'WHATSAPP' ? 'WhatsApp' : 'correo (Gmail)';
  const altLabel = reminderChannel === 'WHATSAPP' ? 'correo (Gmail)' : 'WhatsApp';

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-fg-muted">Forma de pago</label>

      {/* Las tres realidades del pago, como opciones de primera clase */}
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map(({ value, label, hint, Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => set({ outcome: value })}
            aria-pressed={plan.outcome === value}
            className={`rounded-xl border px-3 py-2.5 text-left transition ${
              plan.outcome === value
                ? 'border-brand bg-surface-2 ring-1 ring-brand'
                : 'border-line bg-surface hover:bg-surface-2'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-fg">
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </span>
            <span className="mt-0.5 block text-xs text-fg-faint">{hint}</span>
          </button>
        ))}
      </div>

      {/* Detalle según la opción */}
      {plan.outcome !== 'PENDIENTE' && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-fg-faint">
              {plan.outcome === 'ABONO_PARCIAL' ? 'Método del abono' : 'Método de pago'}
            </label>
            <select
              value={plan.method}
              onChange={(e) => set({ method: e.target.value as PaymentPlan['method'] })}
              className="mt-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="EFECTIVO">Efectivo</option>
              <option value="TRANSFERENCIA">Transferencia</option>
            </select>
          </div>
          {plan.method === 'TRANSFERENCIA' && (
            <div>
              <label className="block text-xs text-fg-faint">Referencia (opcional)</label>
              <input
                value={plan.reference}
                onChange={(e) => set({ reference: e.target.value })}
                placeholder="Nº de comprobante"
                className="mt-1 w-40 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          )}
          {plan.outcome === 'ABONO_PARCIAL' && (
            <div>
              <label className="block text-xs text-fg-faint">Valor pagado (COP)</label>
              <input
                inputMode="numeric"
                value={plan.amountPesos}
                onChange={(e) => set({ amountPesos: e.target.value })}
                placeholder="0"
                className="mt-1 w-36 rounded-lg border border-line bg-surface px-3 py-2 text-right text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          )}
        </div>
      )}

      {plan.outcome !== 'PAGADO_AHORA' && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-fg-faint">
              Vence el{' '}
              <span className="text-fg-faint/70">
                (término de la clínica: {defaultTermsDays} días)
              </span>
            </label>
            <input
              type="date"
              value={plan.dueDate}
              onChange={(e) => set({ dueDate: e.target.value })}
              className="mt-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <label className="mb-1.5 flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={plan.followupEnabled && remindersEnabled}
              disabled={!remindersEnabled}
              onChange={(e) => set({ followupEnabled: e.target.checked })}
              className="size-4 accent-[var(--brand,#111)]"
            />
            Seguimiento automático del saldo
          </label>
        </div>
      )}

      {/* Resumen vivo: saldo + qué hará el sistema */}
      <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-fg-muted">Saldo que quedará pendiente</span>
          <span
            className={`font-semibold ${balanceCents > 0 ? 'text-fg' : 'text-fg-faint'}`}
            data-testid="saldo-pendiente"
          >
            {formatCOP(balanceCents)}
          </span>
        </div>
        <p className="mt-1.5 flex items-start gap-2 text-xs text-fg-faint">
          <MessageCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span data-testid="preview-seguimiento">
            {plan.outcome === 'PAGADO_AHORA' &&
              'Se emitirá el documento y quedará PAGADA. Sin seguimiento de cartera.'}
            {plan.outcome !== 'PAGADO_AHORA' && !remindersEnabled && (
              <>
                Quedará en cartera con vencimiento. Los recordatorios del módulo están
                desactivados: el seguimiento será manual desde el panel.
              </>
            )}
            {plan.outcome !== 'PAGADO_AHORA' && remindersEnabled && !plan.followupEnabled && (
              <>Quedará en cartera con vencimiento, sin seguimiento automático para esta factura.</>
            )}
            {plan.outcome !== 'PAGADO_AHORA' && followupActive && (
              <>
                Si al vencer no hay pago, se recordará por <strong>{channelLabel}</strong>
                {' '}(canal alternativo: {altLabel}, solo si el cliente lo autorizó)
                {firstReminder && (
                  <>
                    {' '}
                    — primer recordatorio estimado:{' '}
                    <strong>
                      {firstReminder.toLocaleDateString('es-CO', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        timeZone: 'America/Bogota',
                      })}
                    </strong>
                  </>
                )}
                . Horarios y frecuencia según Ley 2300 de 2023.
              </>
            )}
          </span>
        </p>
      </div>
    </div>
  );
}

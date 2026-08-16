import Link from 'next/link';
import { ArrowLeft, Wallet } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import {
  getAppliedPaymentMap,
  getBillingSettings,
  listExpenses,
  listPaymentsInRange,
  listSuppliers,
} from '@/lib/facturacion/queries';
import {
  computeFinanceSummary,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from '@/lib/facturacion/domain/finance';
import { formatCOP } from '@/lib/facturacion/domain/money';
import { ExpenseForm, type ExpenseInitial } from '@/components/facturacion/ExpenseForm';
import { IncomeForm, type IncomeInitial } from '@/components/facturacion/IncomeForm';
import { FinanceBars } from '@/components/facturacion/FinanceBars';
import { FinanceTable, type FinanceItem } from '@/components/facturacion/FinanceTable';

export const metadata = { title: "Finanzas · Tuvetia" }


export const dynamic = 'force-dynamic';

/** `YYYY-MM-DD` local Bogotá de un timestamptz (UTC-5 fijo). */
function dateKeyBogota(iso: string): string {
  return new Date(new Date(iso).getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function todayBogota(): string {
  return dateKeyBogota(new Date().toISOString());
}

function monthsAgoStart(months: number): string {
  const [y, m] = todayBogota().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - months, 1));
  return d.toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function FinanzasPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; cat?: string; edit?: string }>;
}) {
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const settings = await getBillingSettings(supabase, clinicId);
  const active = settings?.module_status === 'ACTIVO';

  const sp = await searchParams;
  const today = todayBogota();
  const defaultFrom = `${today.slice(0, 7)}-01`; // mes en curso
  const from = DATE_RE.test(sp.from ?? '') ? sp.from! : defaultFrom;
  const to = DATE_RE.test(sp.to ?? '') ? sp.to! : today;
  const cat = (EXPENSE_CATEGORIES as readonly string[]).includes(sp.cat ?? '')
    ? (sp.cat as ExpenseCategory)
    : undefined;

  if (!active) {
    return (
      <section className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-5xl px-8 py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Ingresos y egresos</h1>
          <p className="mt-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
            El módulo no está activo.{' '}
            <Link href="/dashboard/facturacion/configuracion" className="underline underline-offset-2">
              Configúralo primero
            </Link>
            .
          </p>
        </div>
      </section>
    );
  }

  const barsFrom = monthsAgoStart(5); // últimos 6 meses incluyendo el actual
  const [payments, expenses, barsPayments, barsExpenses, suppliers] = await Promise.all([
    listPaymentsInRange(supabase, clinicId, { from, to }),
    listExpenses(supabase, clinicId, { from, to, category: cat }),
    listPaymentsInRange(supabase, clinicId, { from: barsFrom, to: today }),
    listExpenses(supabase, clinicId, { from: barsFrom, to: today }),
    listSuppliers(supabase, clinicId),
  ]);
  const appliedMap = await getAppliedPaymentMap(supabase, payments.map((p) => p.id));

  // URL base actual (filtros) para armar los links de edición y de cierre.
  const baseParams = new URLSearchParams();
  if (sp.from) baseParams.set('from', from);
  if (sp.to) baseParams.set('to', to);
  if (cat) baseParams.set('cat', cat);
  const hrefWith = (extra?: string) => {
    const p = new URLSearchParams(baseParams);
    if (extra) p.set('edit', extra);
    const qs = p.toString();
    return `/dashboard/facturacion/finanzas${qs ? `?${qs}` : ''}`;
  };

  // ¿Modo edición? edit=EGRESO:<id> | INGRESO:<id>
  let editExpense: ExpenseInitial | null = null;
  let editIncome: IncomeInitial | null = null;
  const [editKind, editId] = (sp.edit ?? '').split(':');
  if (editKind === 'EGRESO' && editId) {
    const e = expenses.find((x) => x.id === editId);
    if (e && !e.purchase_id) {
      editExpense = {
        id: e.id,
        category: e.category,
        // División exacta, sin Math.round: redondear aquí trunca los centavos y guardar el
        // formulario sin tocar nada persistiría un importe distinto al registrado.
        amountPesos: e.amount_cents / 100,
        expenseDate: e.expense_date,
        method: e.method,
        supplierId: e.supplier_id,
        note: e.note,
        hasAttachment: !!e.attachment_path,
      };
    }
  } else if (editKind === 'INGRESO' && editId) {
    const p = payments.find((x) => x.id === editId);
    if (p && !appliedMap.has(p.id)) {
      editIncome = {
        id: p.id,
        method: p.method,
        amountPesos: p.amount_cents / 100, // exacto — ver nota en editExpense

        receivedDate: dateKeyBogota(p.received_at),
        note: p.note,
      };
    }
  }

  const summary = computeFinanceSummary(
    // Con filtro de categoría los ingresos no aplican al KPI (solo egresos).
    cat ? [] : payments.map((p) => ({ amountCents: p.amount_cents, at: p.received_at })),
    expenses.map((e) => ({ amountCents: e.amount_cents, date: e.expense_date, category: e.category })),
  );
  const bars = computeFinanceSummary(
    barsPayments.map((p) => ({ amountCents: p.amount_cents, at: p.received_at })),
    barsExpenses.map((e) => ({ amountCents: e.amount_cents, date: e.expense_date, category: e.category })),
  ).byMonth;

  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const items: FinanceItem[] = [
    ...(cat
      ? []
      : payments.map(
          (p): FinanceItem => ({
            id: p.id,
            kind: 'INGRESO',
            date: dateKeyBogota(p.received_at),
            concept: p.note || p.reference || 'Pago recibido',
            method: p.method,
            amountCents: p.amount_cents,
            appliedToInvoice: appliedMap.has(p.id),
            editHref: appliedMap.has(p.id) ? undefined : hrefWith(`INGRESO:${p.id}`),
            href: appliedMap.has(p.id)
              ? `/dashboard/facturacion/${appliedMap.get(p.id)}`
              : undefined,
          }),
        )),
    ...expenses.map(
      (e): FinanceItem => ({
        id: e.id,
        kind: 'EGRESO',
        date: e.expense_date,
        concept: [
          EXPENSE_CATEGORY_LABELS[e.category as ExpenseCategory] ?? e.category,
          e.supplier_id ? supplierName.get(e.supplier_id) : null,
          e.note,
        ]
          .filter(Boolean)
          .join(' · '),
        method: e.method,
        amountCents: e.amount_cents,
        hasAttachment: !!e.attachment_path,
        fromPurchase: !!e.purchase_id,
        editHref: e.purchase_id ? undefined : hrefWith(`EGRESO:${e.id}`),
        href: e.purchase_id ? `/dashboard/facturacion/compras/${e.purchase_id}` : undefined,
      }),
    ),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const inputCls =
    'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg focus:border-brand focus:outline-none';

  return (
    <section className="flex-1 min-w-0">
      <div className="mx-auto w-full max-w-5xl px-8 py-10">
        <header className="mb-6">
          <Link
            href="/dashboard/facturacion"
            className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Facturación
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg">
            <Wallet className="size-6 text-fg-muted" aria-hidden />
            Ingresos y egresos
          </h1>
          <p className="mt-1 text-sm text-fg-faint">
            Los ingresos son tus pagos recibidos; los egresos, tus gastos y compras de
            inventario. Todo en un solo lugar.
          </p>
        </header>

        {/* Filtros (GET) */}
        <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
          <label className="text-xs text-fg-muted">
            Desde
            <input type="date" name="from" defaultValue={from} className={`${inputCls} mt-1 block`} />
          </label>
          <label className="text-xs text-fg-muted">
            Hasta
            <input type="date" name="to" defaultValue={to} className={`${inputCls} mt-1 block`} />
          </label>
          <label className="text-xs text-fg-muted">
            Categoría (egresos)
            <select name="cat" defaultValue={cat ?? ''} className={`${inputCls} mt-1 block`}>
              <option value="">Todas</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg-muted hover:text-fg transition"
          >
            Aplicar
          </button>
        </form>

        {/* KPIs del período */}
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
              Ingresos del período
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-ok">
              {cat ? '—' : formatCOP(summary.incomeCents)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
              Egresos del período
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-warn">
              {formatCOP(summary.expenseCents)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Neto</p>
            <p
              className={`mt-1 text-xl font-semibold tabular-nums ${
                summary.netCents >= 0 ? 'text-ok' : 'text-warn'
              }`}
            >
              {cat ? '—' : formatCOP(summary.netCents)}
            </p>
          </div>
        </div>

        {/* Barras últimos 6 meses */}
        <div className="mb-6">
          <FinanceBars data={bars} />
        </div>

        {/* Alta/edición de movimientos. El key por registro es OBLIGATORIO: los campos son no
            controlados (defaultValue), y sin key React reconcilia el formulario al pasar de editar
            A a editar B — el id oculto cambia a B pero los importes en pantalla siguen siendo los
            de A, y guardar persiste los valores de A sobre el registro B. */}
        {editIncome || editExpense ? (
          <div className="mb-6">
            {editIncome ? (
              <IncomeForm key={`ing-${editIncome.id}`} today={today} initial={editIncome} closeHref={hrefWith()} />
            ) : (
              <ExpenseForm
                key={`egr-${editExpense!.id}`}
                suppliers={suppliers}
                today={today}
                initial={editExpense}
                closeHref={hrefWith()}
              />
            )}
          </div>
        ) : (
          <div className="mb-6 flex flex-wrap gap-3">
            <ExpenseForm key="egr-nuevo" suppliers={suppliers} today={today} />
            <IncomeForm key="ing-nuevo" today={today} />
          </div>
        )}

        {/* Tabla combinada + export */}
        <FinanceTable items={items} />
      </div>
    </section>
  );
}

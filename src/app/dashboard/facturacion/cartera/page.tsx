// Bandeja de cartera (§10 + §11 del plan): panorama de recaudo, próximos
// recordatorios y — lo más importante — los casos que requieren atención humana.

import Link from 'next/link';
import { ArrowLeft, CalendarClock, Inbox } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import { getBillingSettings } from '@/lib/facturacion/queries';
import {
  getOpenHumanTasks,
  getOpenReceivables,
  getUpcomingReminders,
} from '@/lib/cartera/queries';
import { formatCOP, fmtDate, fmtDateTime } from '@/lib/facturacion/format';
import { computeAging } from '@/lib/facturacion/domain/aging';
import { CollectionBadge, FollowupBadge } from '@/components/facturacion/badges';
import { HumanTasksPanel, type TaskItem } from '@/components/cartera/HumanTasksPanel';
import { RunSweepButton } from '@/components/cartera/RunSweepButton';
import { TrLink } from '@/components/ui/TrLink';
import { PageShell } from '@/components/ui/page-shell';

export const metadata = { title: "Cartera · Tuvetia" }


export const dynamic = 'force-dynamic';

export default async function CarteraPage() {
  // Verificación local del JWT (sin round-trip) — patrón getCachedUser.
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const settings = await getBillingSettings(supabase, clinicId);
  if (settings?.module_status !== 'ACTIVO') {
    return (
      <PageShell width="narrow">
        <h1 className="text-2xl font-semibold text-fg">Cartera</h1>
        <p className="mt-4 rounded-xl border border-line bg-surface p-6 text-sm text-fg-muted">
          Activa el módulo de facturación para gestionar la cartera.{' '}
          <Link href="/dashboard/facturacion" className="underline underline-offset-2">
            Ir a Facturación
          </Link>
        </p>
      </PageShell>
    );
  }

  const [receivables, reminders, tasks] = await Promise.all([
    getOpenReceivables(supabase, clinicId),
    getUpcomingReminders(supabase, clinicId),
    getOpenHumanTasks(supabase, clinicId),
  ]);

  const now = new Date();
  const outstanding = receivables.reduce((a, r) => a + r.balance_cents, 0);
  const aging = computeAging(
    receivables.map((r) => ({ balanceCents: r.balance_cents, dueDate: r.due_date })),
    now,
  );
  const overdue = aging.totalOverdueCents;

  // Próxima acción por factura: primer recordatorio programado (ya vienen asc).
  const nextAction = new Map<string, string>();
  for (const rem of reminders) {
    if (rem.invoice_id && !nextAction.has(rem.invoice_id)) {
      nextAction.set(rem.invoice_id, rem.scheduled_for);
    }
  }

  const taskItems: TaskItem[] = tasks.map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    invoiceId: t.invoice_id,
    invoiceNumber: t.invoice?.full_number ?? null,
    createdAt: t.created_at,
  }));

  return (
    <PageShell>
      <Link
        href="/dashboard/facturacion"
        className="inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Facturación
      </Link>
      {/* `items-end` como el resto de las cabeceras del módulo: con `items-center` la acción de la
          derecha se centraba contra el bloque ENTERO de título + descripción, así que flotaba a
          media altura en vez de apoyarse en la línea de base. Se veía poco cuando la pantalla
          medía 1024px; con los 1200 de PageShell quedó a la vista. */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Cartera</h1>
          <p className="mt-1 text-sm text-fg-faint">
            Seguimiento de recaudo bajo la Ley 2300 de 2023.
          </p>
        </div>
        {settings.reminders_enabled ? (
          <RunSweepButton />
        ) : (
          <span className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-fg-muted">
            Recordatorios automáticos desactivados — seguimiento manual
          </span>
        )}
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Saldo pendiente" value={formatCOP(outstanding)} />
        <Kpi label="Cartera vencida" value={formatCOP(overdue)} tone="warn" />
        <Kpi label="Facturas por cobrar" value={String(receivables.length)} />
        <Kpi label="Requieren atención" value={String(tasks.length)} tone={tasks.length ? 'warn' : undefined} />
      </div>

      {/* Antigüedad de cartera (aging) */}
      {aging.totalCents > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-fg">Antigüedad de cartera</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <AgingCell label="Corriente" bucket={aging.corriente} />
            <AgingCell label="1–30 días" bucket={aging.d1_30} tone="warn" />
            <AgingCell label="31–60 días" bucket={aging.d31_60} tone="warn" />
            <AgingCell label="61–90 días" bucket={aging.d61_90} tone="warn" />
            <AgingCell label="90+ días" bucket={aging.d90plus} tone="warn" />
          </div>
        </section>
      )}

      {/* Requiere atención humana */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
          <Inbox className="size-4" aria-hidden />
          Requiere tu atención
        </h2>
        <HumanTasksPanel tasks={taskItems} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Cartera viva */}
        <section>
          <h2 className="mb-2 text-sm font-medium text-fg">Facturas por cobrar</h2>
          {receivables.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-fg-faint">
              Sin saldos pendientes. Toda la cartera está al día.
            </p>
          ) : (
            // `overflow-x-auto` y no `overflow-hidden`: con siete columnas en un teléfono, la
            // tabla se aprieta hasta ser ilegible en vez de poder desplazarse. Es lo que hacen las
            // otras trece tablas del repo; ésta era la única distinta. El radio del borde se
            // sigue respetando igual.
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs text-fg-faint">
                  <tr>
                    <th className="px-3 py-2 font-medium">Factura</th>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Vence</th>
                    <th className="px-3 py-2 text-right font-medium">Saldo</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-3 py-2 font-medium">Próxima acción</th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.map((r) => (
                    <TrLink
                      key={r.id}
                      href={`/dashboard/facturacion/${r.id}`}
                      className="border-t border-line hover:bg-surface-2/50"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/dashboard/facturacion/${r.id}`}
                          className="text-fg underline-offset-2 hover:underline"
                        >
                          {r.full_number ?? '—'}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{r.payer?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-fg-muted">{fmtDate(r.due_date)}</td>
                      <td className="px-3 py-2 text-right font-medium text-fg">
                        {formatCOP(r.balance_cents)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <CollectionBadge status={r.collection_status} />
                          <FollowupBadge status={r.followup_status} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-faint">
                        {nextAction.has(r.id) ? fmtDateTime(nextAction.get(r.id)!) : '—'}
                      </td>
                    </TrLink>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Próximos recordatorios */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
            <CalendarClock className="size-4" aria-hidden />
            Próximos recordatorios
          </h2>
          {reminders.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-fg-faint">
              Nada programado.
            </p>
          ) : (
            <ul className="space-y-1.5" data-testid="upcoming-reminders">
              {reminders.map((rem) => (
                <li
                  key={rem.id}
                  className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-xs"
                >
                  <span className="text-fg">
                    {rem.invoice?.full_number ?? 'factura'}
                    <span className="ml-1 text-fg-faint">
                      · {rem.step_kind.replaceAll('_', ' ').toLowerCase()}
                    </span>
                  </span>
                  <span className="text-fg-faint">{fmtDateTime(rem.scheduled_for)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-xs text-fg-faint">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${tone === 'warn' ? 'text-warn' : 'text-fg'}`}>
        {value}
      </div>
    </div>
  );
}

function AgingCell({
  label,
  bucket,
  tone,
}: {
  label: string;
  bucket: { amountCents: number; count: number };
  tone?: 'warn';
}) {
  const active = bucket.amountCents > 0;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="text-[11.5px] font-medium text-fg-faint">{label}</div>
      <div
        className={`mt-0.5 text-base font-semibold ${active && tone === 'warn' ? 'text-warn' : 'text-fg'}`}
      >
        {formatCOP(bucket.amountCents)}
      </div>
      <div className="text-[11px] text-fg-faint">{bucket.count} factura(s)</div>
    </div>
  );
}

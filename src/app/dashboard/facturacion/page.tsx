import Link from 'next/link';
import {
  Receipt,
  Plus,
  Boxes,
  BookOpen,
  Settings2,
  FlaskConical,
  Stethoscope,
  MailWarning,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import {
  getActiveRange,
  getBillingSettings,
  getDashboardKpis,
  getUnbilledConsultations,
  getUnsentIssuedCount,
} from '@/lib/facturacion/queries';
import { formatCOP, fmtDate } from '@/lib/facturacion/format';
import {
  CollectionBadge,
  DeliveryBadge,
  FiscalBadge,
  LifecycleBadge,
} from '@/components/facturacion/badges';
import type { InvoiceRow } from '@/lib/supabase/types';
import { TrLink } from '@/components/ui/TrLink';

export const dynamic = 'force-dynamic';

type InvoiceWithPayer = InvoiceRow & { payer: { name: string } | null };

// ─── Piezas de presentación (estilo mockup app-rediseno-shadcn) ──────────────

const TH_BASE =
  'border-b border-line-soft px-3.5 py-[9px] text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground';

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line-soft bg-card px-[17px] pb-[13px] pt-[15px] shadow-sm">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </p>
      <p className="font-display text-[23px] font-semibold leading-[1.1] tracking-[-0.02em] tabular-nums text-fg">
        {value}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">{sub}</p>
    </div>
  );
}

export default async function FacturacionPage() {
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  // Inicio de mes en Bogotá (UTC-5 fijo, sin DST): la frontera del KPI es la del negocio, no la
  // del servidor — en Vercel (UTC) el corte de mes caía 5 horas antes.
  const nowUtc = new Date();
  const bogota = new Date(nowUtc.getTime() - 5 * 3_600_000);
  const monthStartIso = new Date(
    Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), 1, 5),
  ).toISOString();

  // Una sola ola: settings y datos del dashboard no dependen entre sí. El listado sigue trayendo
  // las últimas 100 (es una tabla de recientes); los KPIs de dinero YA NO salen de esas 100 filas
  // sino de agregados sobre todo el historial (getDashboardKpis).
  const [settings, { data }, unbilled, unsentCount, kpis] = await Promise.all([
    getBillingSettings(supabase, clinicId),
    supabase
      .from('invoices')
      .select('*, payer:billing_payers(name)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(100),
    getUnbilledConsultations(supabase, clinicId, { limit: 25 }),
    getUnsentIssuedCount(supabase, clinicId),
    getDashboardKpis(supabase, clinicId, monthStartIso),
  ]);
  const active = settings?.module_status === 'ACTIVO';

  // ── Módulo sin activar: tarjeta de activación voluntaria ──────────────────
  if (!active) {
    return (
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-3xl px-[30px] pb-16 pt-7">
          <header className="mb-6">
            <h1 className="font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.022em] text-fg">
              Facturación
            </h1>
            <p className="mt-[3px] text-[13px] text-fg-muted">
              Factura tus consultas y productos sin salir de Tuvetia.
            </p>
          </header>

          <div className="rounded-lg border border-line-soft bg-card p-8 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-secondary">
                <Receipt className="size-5 text-fg" aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-medium text-fg">Facturación y recaudo</h2>
                <p className="text-sm text-fg-faint">
                  POS electrónico y factura electrónica de venta (DIAN), inventario y
                  cartera — conectado a tus pacientes y consultas.
                </p>
              </div>
            </div>

            <ul className="mt-6 grid gap-2 text-sm text-fg-muted sm:grid-cols-2">
              <li>· Factura la consulta del día en dos clics</li>
              <li>· Catálogo de servicios y productos con IVA por ítem</li>
              <li>· Inventario por movimientos, lotes y vencimientos</li>
              <li>· Pagos en efectivo y transferencia, saldo al día</li>
            </ul>

            <div className="mt-7 flex items-center gap-3">
              <Button render={<Link href="/dashboard/facturacion/configuracion" />}>Configurar y activar</Button>
              <span className="text-xs text-fg-faint">
                Toma ~2 minutos. Empiezas en modo de prueba (sandbox).
              </span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── Módulo activo: KPIs + lista + puente CRM ──────────────────────────────
  const invoices = (data as InvoiceWithPayer[] | null) ?? [];

  const { billedCents, collectedCents, issuedCount, outstandingCents, openCount, overdueCount } =
    kpis;
  const drafts = kpis.draftCount;
  // Una sola fuente de verdad para una afirmación FISCAL: el rango de numeración activo (igual que
  // configuración). La heurística anterior (startsWith('S') sobre las últimas 100 facturas) daba
  // falso "sin validez fiscal" con prefijos legítimos tipo SETP y con cero facturas emitidas.
  const activeRange = await getActiveRange(supabase, clinicId, settings!.default_doc_kind);
  const sandbox = !activeRange || activeRange.is_sandbox;

  // Etiqueta del mes en curso, solo presentación (ej. "julio 2026").
  const now = new Date();
  const monthName = now.toLocaleDateString('es-CO', {
    month: 'long',
    timeZone: 'America/Bogota',
  });
  const monthLabel = `${monthName} ${now.getFullYear()}`;

  return (
    <main className="min-w-0 flex-1">
      <div className="mx-auto w-full max-w-[1200px] px-[30px] pb-16 pt-7">
        {/* ── Page head ── */}
        <header className="mb-[22px] flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.022em] text-fg">
              Facturación
            </h1>
            <p className="mt-[3px] text-[13px] text-fg-muted">
              Factura electrónica DIAN · {monthLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button render={<Link href="/dashboard/facturacion/finanzas" />} variant="outline">
                <Wallet aria-hidden />
                Finanzas
              </Button>
            <Button render={<Link href="/dashboard/facturacion/cartera" />} variant="outline">
                <MailWarning aria-hidden />
                Cartera
              </Button>
            <Button render={<Link href="/dashboard/facturacion/inventario" />} variant="outline">
                <Boxes aria-hidden />
                Inventario
              </Button>
            <Button render={<Link href="/dashboard/facturacion/catalogo" />} variant="outline">
                <BookOpen aria-hidden />
                Catálogo
              </Button>
            <Button render={<Link href="/dashboard/facturacion/configuracion" />} variant="outline">
                <Settings2 aria-hidden />
                Configuración
              </Button>
            <Button render={<Link href="/dashboard/facturacion/nueva" />}>
                <Plus aria-hidden />
                Nueva factura
              </Button>
          </div>
        </header>

        {sandbox && (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-4 py-2.5 text-xs text-fg-muted">
            <FlaskConical className="size-3.5 shrink-0" aria-hidden />
            Modo sandbox: los documentos no tienen validez fiscal hasta conectar el
            proveedor DIAN.
          </div>
        )}

        {/* Puente CRM: qué clientes necesitan factura / envío */}
        {(unbilled.length > 0 || unsentCount > 0) && (
          <div className="mb-5 flex flex-wrap gap-2">
            {unbilled.length > 0 && (
              <Link
                href="/dashboard/facturacion/nueva"
                className="inline-flex items-center gap-2 rounded-lg border border-warn/40 bg-card px-3 py-2 text-xs text-warn transition hover:bg-accent"
              >
                <Stethoscope className="size-3.5" aria-hidden />
                {unbilled.length === 1
                  ? '1 consulta reciente sin facturar'
                  : `${unbilled.length} consultas recientes sin facturar`}
                <span className="text-fg-faint">
                  ({unbilled
                    .slice(0, 3)
                    .map((c) => c.patientName)
                    .join(', ')}
                  {unbilled.length > 3 ? '…' : ''})
                </span>
              </Link>
            )}
            {unsentCount > 0 && (
              <span className="inline-flex items-center gap-2 rounded-lg border border-line-soft bg-card px-3 py-2 text-xs text-fg-muted">
                <MailWarning className="size-3.5" aria-hidden />
                {unsentCount === 1
                  ? '1 factura emitida sin enviar al cliente'
                  : `${unsentCount} facturas emitidas sin enviar al cliente`}
              </span>
            )}
          </div>
        )}

        {/* ── Stat row ── */}
        <div className="mb-[22px] grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
          <StatCard
            label={`Facturado en ${monthName}`}
            value={formatCOP(billedCents)}
            sub={issuedCount === 1 ? '1 factura emitida' : `${issuedCount} facturas emitidas`}
          />
          <StatCard
            label="Recaudado este mes"
            value={formatCOP(collectedCents)}
            sub="pagos aplicados a facturas del mes"
          />
          <StatCard
            label="Por cobrar"
            value={formatCOP(outstandingCents)}
            sub={
              <>
                {openCount === 1 ? '1 factura con saldo' : `${openCount} facturas con saldo`}
                {overdueCount > 0 && (
                  <span className="font-medium text-warn">
                    · {overdueCount} {overdueCount === 1 ? 'vencida' : 'vencidas'}
                  </span>
                )}
              </>
            }
          />
          <StatCard
            label="Borradores"
            value={String(drafts)}
            sub="por emitir"
          />
        </div>

        {/* ── Tabla de facturas ── */}
        <div className="mb-[14px] overflow-hidden rounded-lg border border-line-soft bg-card shadow-sm">
          {invoices.length === 0 ? (
            <p className="px-4 py-8 text-sm text-fg-faint">
              Todavía no hay facturas. Crea la primera con «Nueva factura».
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={TH_BASE}>Factura</th>
                    <th className={TH_BASE}>Cliente</th>
                    <th className={TH_BASE}>Fecha</th>
                    <th className={TH_BASE}>Estado</th>
                    <th className={TH_BASE}>Fiscal · Recaudo · Envío</th>
                    <th className={`${TH_BASE} text-right`}>Valor</th>
                    <th className={`${TH_BASE} text-right`}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <TrLink
                      key={i.id}
                      href={`/dashboard/facturacion/${i.id}`}
                      className="border-b border-line-soft transition-colors last:border-0 hover:bg-accent"
                    >
                      <td className="px-3.5 py-[11px] align-middle font-mono text-xs font-medium tabular-nums">
                        <Link
                          href={`/dashboard/facturacion/${i.id}`}
                          className="text-fg underline-offset-2 hover:underline"
                        >
                          {i.full_number ?? `Borrador · ${i.doc_kind === 'POS' ? 'POS' : 'FV'}`}
                        </Link>
                      </td>
                      <td className="px-3.5 py-[11px] align-middle font-semibold text-fg">
                        {i.payer?.name ?? '—'}
                      </td>
                      <td className="px-3.5 py-[11px] align-middle font-mono text-xs tabular-nums text-fg-muted">
                        {fmtDate(i.issued_at ?? i.created_at)}
                      </td>
                      <td className="px-3.5 py-[11px] align-middle">
                        <LifecycleBadge status={i.status} />
                      </td>
                      <td className="px-3.5 py-[11px] align-middle">
                        <span className="inline-flex flex-wrap gap-1">
                          <FiscalBadge status={i.fiscal_status} />
                          {i.status === 'EMITIDA' && (
                            <>
                              <CollectionBadge status={i.collection_status} />
                              <DeliveryBadge status={i.delivery_status} />
                            </>
                          )}
                        </span>
                      </td>
                      <td className="px-3.5 py-[11px] text-right align-middle font-mono text-xs tabular-nums text-fg">
                        {formatCOP(i.total_cents)}
                      </td>
                      <td className="px-3.5 py-[11px] text-right align-middle font-mono text-xs tabular-nums text-fg-muted">
                        {i.status === 'EMITIDA' ? formatCOP(i.balance_cents) : '—'}
                      </td>
                    </TrLink>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Cobranza automática (estado, se gestiona en configuración) ── */}
        <div className="grid gap-[13px] [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          <div className="rounded-lg border border-line-soft bg-card px-[18px] py-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[14.5px] font-semibold tracking-[-0.005em] text-fg">
                  Cobranza automática
                </h2>
                <p className="mt-0.5 text-[12.5px] text-fg-muted">
                  Recordatorios de pago — máx. 1 por semana (Ley 2300)
                </p>
              </div>
              {settings?.reminders_enabled ? (
                <span className="inline-flex h-[21px] items-center gap-[5px] whitespace-nowrap rounded-full border border-ok/40 bg-surface px-2 text-[11.5px] font-medium text-ok">
                  <span aria-hidden className="size-[5px] rounded-full bg-current" />
                  Activada
                </span>
              ) : (
                <span className="inline-flex h-[21px] items-center whitespace-nowrap rounded-full border border-line bg-surface px-2 text-[11.5px] font-medium text-fg-muted">
                  Desactivada
                </span>
              )}
            </div>
            <Link
              href="/dashboard/facturacion/configuracion"
              className="mt-3 inline-block text-[12.5px] font-medium text-brand underline-offset-[3px] hover:underline"
            >
              Gestionar en configuración
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

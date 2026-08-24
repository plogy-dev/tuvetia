import Link from 'next/link';
import { TOPE_SIN_FACTURAR, hayMasQueElTope } from '@/lib/facturacion/sin-facturar';
import {
  MailWarning,
  Receipt,
  Plus,
  FlaskConical,
  Stethoscope,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import {
  getActiveRange,
  getBillingSettings,
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
import { PageHeader, PageShell } from '@/components/ui/page-shell';
import { FormularioDeFiltros } from '@/components/ui/formulario-de-filtros';
import { MenuDeVentas } from '@/components/facturacion/MenuDeVentas';

export const metadata = { title: "Ventas · Tuvetia" }


export const dynamic = 'force-dynamic';

type InvoiceWithPayer = InvoiceRow & { payer: { name: string } | null };

// ─── Piezas de presentación (estilo mockup app-rediseno-shadcn) ──────────────

// Vocabulario REAL de la base (`invoices_status_check` y `invoices_doc_kind_check`), no inventado.
// Son listas cerradas porque lo que llega por la URL es entrada de fuera.
const DOC_KINDS = ['FACTURA_VENTA', 'POS'];
const ESTADOS = ['BORRADOR', 'EMITIENDO', 'EMITIDA', 'ANULADA'];

/** `YYYY-MM-DD` y nada más. */
function esFecha(v: string | undefined): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

const TH_BASE =
  'border-b border-line-soft px-3.5 py-[9px] text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground';

// Los filtros viajan por la URL y no por estado de cliente: así una búsqueda se puede compartir,
// se puede volver con el botón de atrás, y la pantalla sigue siendo un componente de servidor sin
// una sola línea de JavaScript enviada al navegador.
type FiltrosDeVentas = Promise<{ desde?: string; hasta?: string; tipo?: string; estado?: string }>;

export default async function FacturacionPage({ searchParams }: { searchParams: FiltrosDeVentas }) {
  const f = await searchParams;
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;


  // Una sola ola: settings y datos del dashboard no dependen entre sí. El listado sigue trayendo
  // las últimas 100 (es una tabla de recientes); los KPIs de dinero YA NO salen de esas 100 filas
  // sino de agregados sobre todo el historial (getDashboardKpis).
  // `getDashboardKpis` se fue con las tarjetas: era un agregado sobre TODO el historial que ahora
  // no se pinta en ningún lado de esta pantalla. Las cifras viven en Finanzas, que las calcula por
  // su cuenta. Un viaje de red menos en la ruta más visitada de la zona.
  const [settings, { data }, unbilled, unsentCount] = await Promise.all([
    getBillingSettings(supabase, clinicId),
    (() => {
      // SE FILTRA EN LA BASE, no en memoria: el tope de 100 se aplica DESPUÉS del filtro, así que
      // buscar una factura de marzo entre miles la encuentra. Filtrando en JS sobre las últimas
      // 100, marzo simplemente no estaría.
      let q = supabase
        .from('invoices')
        .select('*, payer:billing_payers(name)')
        .eq('clinic_id', clinicId);
      // Los valores vienen de la URL, o sea de fuera: se comparan contra las listas cerradas de
      // abajo antes de tocar la consulta. Un `estado=<script>` no llega a Postgres.
      if (f.tipo && DOC_KINDS.includes(f.tipo)) q = q.eq('doc_kind', f.tipo);
      if (f.estado && ESTADOS.includes(f.estado)) q = q.eq('status', f.estado);
      if (esFecha(f.desde)) q = q.gte('created_at', `${f.desde}T00:00:00-05:00`);
      // `hasta` es INCLUSIVO: quien escribe 31 de agosto espera que entren las de ese día.
      if (esFecha(f.hasta)) q = q.lte('created_at', `${f.hasta}T23:59:59-05:00`);
      return q.order('created_at', { ascending: false }).limit(100);
    })(),
    getUnbilledConsultations(supabase, clinicId, { limit: 25 }),
    getUnsentIssuedCount(supabase, clinicId),
  ]);
  const active = settings?.module_status === 'ACTIVO';

  // ── Módulo sin activar: tarjeta de activación voluntaria ──────────────────
  if (!active) {
    return (
      <PageShell width="narrow">
          <PageHeader
            title="Ventas"
            description="Factura tus consultas y productos sin salir de Tuvetia."
          />

          <div className="rounded-lg border border-line-soft bg-card p-8">
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
      </PageShell>
    );
  }

  // ── Módulo activo: lista + avisos + puente CRM ────────────────────────────
  const invoices = (data as InvoiceWithPayer[] | null) ?? [];
  const hayFiltro = Boolean(f.desde || f.hasta || f.tipo || f.estado);
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
    <PageShell>
        <PageHeader
          title="Ventas"
          description={`Factura electrónica DIAN · ${monthLabel}`}
          actions={
            <>
              {/* UNA sola acción destacada, como en la referencia. Los cinco destinos —Finanzas,
                  Cartera, Inventario, Catálogo, Configuración— se fueron al menú: no son acciones,
                  y con el mismo peso que «Nueva factura» convertían la cabecera en una pared de
                  seis opciones donde la que sirve para cobrar era la última. */}
              <MenuDeVentas />
              <Button render={<Link href="/dashboard/facturacion/nueva" />}>
                <Plus aria-hidden />
                Nueva factura
              </Button>
            </>
          }
        />

        {sandbox && (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-4 py-2.5 text-xs text-fg-muted">
            <FlaskConical className="size-3.5 shrink-0" aria-hidden />
            Modo sandbox: los documentos no tienen validez fiscal hasta conectar el
            proveedor DIAN.
          </div>
        )}

        {/* Puente CRM: qué clientes necesitan factura / envío */}
        {(unbilled.total > 0 || unsentCount > 0) && (
          <div className="mb-5 flex flex-wrap gap-2">
            {unbilled.total > 0 && (
              <Link
                href="/dashboard/facturacion/nueva"
                className="inline-flex items-center gap-2 rounded-lg border border-warn/40 bg-card px-3 py-2 text-xs text-warn transition hover:bg-accent"
              >
                <Stethoscope className="size-3.5" aria-hidden />
                {/* EL NÚMERO ES EL TOTAL, no el de la página. Es el mismo que anuncia el riel de
                    pendientes, y si acá dijera el de la página los dos se contradirían. */}
                {unbilled.total === 1
                  ? '1 consulta reciente sin facturar'
                  : `${hayMasQueElTope(unbilled.total) ? `${TOPE_SIN_FACTURAR}+` : unbilled.total} consultas recientes sin facturar`}
                <span className="text-fg-faint">
                  ({unbilled.consultas
                    .slice(0, 3)
                    .map((c) => c.patientName)
                    .join(', ')}
                  {unbilled.total > 3 ? '…' : ''})
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

        {/* ── LAS CIFRAS NO VIVEN ACÁ ──────────────────────────────────────────────────────
            Esta pantalla es un LIBRO DE VENTAS: documentos, con sus filtros. Tenía encima cuatro
            tarjetas —facturado, recaudado, por cobrar, borradores— que la convertían en dos cosas a
            la vez y empujaban la tabla debajo del pliegue.

            Es lo que hace la referencia: en OkVet «Ventas, recibos y facturas» no tiene una sola
            métrica, y su «Dashboard de ventas» es OTRA pantalla (de hecho, de pago). Acá el
            equivalente ya existe y es gratis: Finanzas, en el menú de Secciones.

            NO SE PIERDE NADA. Lo que de verdad exige acción —facturas emitidas sin enviar, consultas
            sin facturar, cartera vencida— sigue arriba como aviso, que es donde sirve: un número en
            una tarjeta se mira, un aviso se atiende. */}


        {/* ── Filtros ──
            La lista traía las últimas 100 SIN forma de acotarlas: con un par de meses de uso, una
            factura de marzo no se podía encontrar. Son los mismos tres ejes por los que filtra
            cualquier libro de ventas —cuándo, qué documento, en qué estado— y viajan por la URL.

            Es un `form` GET, sin JavaScript: el navegador arma la query, la página sigue siendo de
            servidor, y el resultado se puede compartir o volver con el botón de atrás. */}
        <FormularioDeFiltros
          action="/dashboard/facturacion"
          className="mb-3 flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-fg-muted">Desde</span>
            <input
              type="date"
              name="desde"
              defaultValue={f.desde ?? ''}
              className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-fg"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-fg-muted">Hasta</span>
            <input
              type="date"
              name="hasta"
              defaultValue={f.hasta ?? ''}
              className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-fg"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-fg-muted">Documento</span>
            <select
              name="tipo"
              defaultValue={f.tipo ?? ''}
              className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-fg"
            >
              <option value="">Todos</option>
              <option value="FACTURA_VENTA">Factura electrónica</option>
              <option value="POS">Tiquete POS</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-fg-muted">Estado</span>
            <select
              name="estado"
              defaultValue={f.estado ?? ''}
              className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-fg"
            >
              <option value="">Todos</option>
              <option value="BORRADOR">Borrador</option>
              <option value="EMITIDA">Emitida</option>
              <option value="ANULADA">Anulada</option>
            </select>
          </label>
          <Button type="submit" variant="outline" className="h-9">
            Filtrar
          </Button>
          {hayFiltro && (
            <Link
              href="/dashboard/facturacion"
              className="h-9 self-end px-2 text-sm text-fg-muted underline underline-offset-2 hover:text-fg"
            >
              Limpiar
            </Link>
          )}
        </FormularioDeFiltros>

        {/* ── Tabla de facturas ── */}
        <div className="mb-[14px] overflow-hidden rounded-lg border border-line-soft bg-card">
          {invoices.length === 0 ? (
            hayFiltro ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              {/* DOS VACÍOS DISTINTOS. "No hay facturas" cuando el filtro es el que no encuentra
                  nada se lee como que se perdieron los datos. */}
              <p className="text-base font-medium text-fg">Ninguna factura con esos filtros</p>
              <p className="max-w-sm text-sm text-fg-muted">
                Probá ampliar el rango de fechas, o quitá el tipo de documento y el estado.
              </p>
              <Button
                render={<Link href="/dashboard/facturacion" />}
                variant="outline"
                className="mt-2"
              >
                Limpiar filtros
              </Button>
            </div>
            ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <p className="text-base font-medium text-fg">Todavía no facturaste nada</p>
              {/* QUÉ VA A PASAR AL APRETAR, dicho antes de apretar. El primer paso de «Nueva
                  factura» es un buscador, no una factura, y sin avisarlo se lee como que el botón
                  llevó a otro lado. */}
              <p className="max-w-sm text-sm text-fg-muted">
                Empezás eligiendo el paciente o el titular —o una venta de mostrador— y desde ahí
                armás la factura.
              </p>
              <Button render={<Link href="/dashboard/facturacion/nueva" />} className="mt-2">
                <Plus aria-hidden />
                Crear la primera factura
              </Button>
            </div>
            )
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
          <div className="rounded-lg border border-line-soft bg-card px-[18px] py-4">
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
    </PageShell>
  );
}

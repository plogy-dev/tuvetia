import Link from 'next/link';
import { TOPE_SIN_FACTURAR, hayMasQueElTope } from '@/lib/facturacion/sin-facturar';
import {
  CalendarDays,
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
import { formatCOP, fmtDate, fmtDateTime } from '@/lib/facturacion/format';
import { terminoBuscable } from '@/lib/facturacion/busqueda-de-ventas';
import { CONTROL, TD, TD_NUM, TH, TH_DER } from '@/components/facturacion/densidad';
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

type InvoiceWithPayer = InvoiceRow & {
  payer: { name: string; doc_type: string | null; doc_number: string | null } | null;
  usuario: { full_name: string | null } | null;
};

// ─── Piezas de presentación (estilo mockup app-rediseno-shadcn) ──────────────

// Vocabulario REAL de la base (`invoices_status_check` y `invoices_doc_kind_check`), no inventado.
// Son listas cerradas porque lo que llega por la URL es entrada de fuera.
const DOC_KINDS = ['FACTURA_VENTA', 'POS'];
const ESTADOS = ['BORRADOR', 'EMITIENDO', 'EMITIDA', 'ANULADA'];

/** `YYYY-MM-DD` y nada más. */
function esFecha(v: string | undefined): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Cuántas filas por página ofrece la referencia. Lista cerrada: llega por la URL. */
const POR_PAGINA = [10, 25, 50, 100];

/** Hoy en Bogotá, `YYYY-MM-DD`. La clínica factura en su hora, no en UTC. */
function hoyEnBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

// La densidad vive en `components/facturacion/densidad.ts`: estaba copiada en cinco archivos con
// valores parecidos pero distintos, que es como una tabla termina viéndose de otro módulo.

// Los filtros viajan por la URL y no por estado de cliente: así una búsqueda se puede compartir,
// se puede volver con el botón de atrás, y la pantalla sigue siendo un componente de servidor sin
// una sola línea de JavaScript enviada al navegador.
type FiltrosDeVentas = Promise<{
  desde?: string;
  hasta?: string;
  tipo?: string;
  estado?: string;
  /** Texto libre: número de documento o nombre del cliente. */
  q?: string;
  /** Cuántas filas por página. */
  n?: string;
  /** Página, 1-based. */
  p?: string;
  /** `todo=1` apaga el «Hoy» por defecto y muestra el histórico. */
  todo?: string;
}>;

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
  // ── EL RANGO ARRANCA EN «HOY», como la referencia ───────────────────────────────────────────
  //
  // OkVet abre su libro de ventas con el chip «Hoy: <fecha>» puesto, no con el histórico. Tiene
  // sentido para un mostrador: lo que se mira veinte veces al día es lo de HOY. El histórico está a
  // un clic («Ver todo») y el chip dice en letra grande qué se está mirando, para que nadie crea
  // que se le perdieron las facturas.
  const verTodo = f.todo === '1';
  const hoy = hoyEnBogota();
  const desde = esFecha(f.desde) ? f.desde : verTodo ? undefined : hoy;
  const hasta = esFecha(f.hasta) ? f.hasta : verTodo ? undefined : hoy;

  const busqueda = terminoBuscable(f.q);
  const porPagina = POR_PAGINA.includes(Number(f.n)) ? Number(f.n) : 10;
  const pagina = Math.max(1, Math.floor(Number(f.p)) || 1);

  // Buscar por NOMBRE DEL CLIENTE necesita resolver antes qué pagadores coinciden: el nombre vive
  // en otra tabla, y filtrar sobre el recurso embebido exigiría un `!inner` que dejaría fuera las
  // ventas de mostrador (las que no tienen pagador). Un viaje extra, y sólo cuando se busca.
  let pagadoresQueCoinciden: string[] = [];
  if (busqueda) {
    const { data: ps } = await supabase
      .from('billing_payers')
      .select('id')
      .eq('clinic_id', clinicId)
      .ilike('name', `%${busqueda}%`)
      .limit(200);
    pagadoresQueCoinciden = (ps ?? []).map((x) => (x as { id: string }).id);
  }

  const [settings, { data, count }, unbilled, unsentCount] = await Promise.all([
    getBillingSettings(supabase, clinicId),
    (() => {
      // SE FILTRA Y SE PAGINA EN LA BASE, no en memoria: la página que se pide es la que se trae.
      // Filtrando en JS sobre las últimas 100, una factura de marzo simplemente no estaría.
      let q = supabase
        .from('invoices')
        .select(
          '*, payer:billing_payers!invoices_payer_id_fkey(name, doc_type, doc_number), usuario:profiles!invoices_created_by_fkey(full_name)',
          { count: 'exact' },
        )
        .eq('clinic_id', clinicId);
      // Los valores vienen de la URL, o sea de fuera: se comparan contra las listas cerradas de
      // arriba antes de tocar la consulta. Un `estado=<script>` no llega a Postgres.
      if (f.tipo && DOC_KINDS.includes(f.tipo)) q = q.eq('doc_kind', f.tipo);
      if (f.estado && ESTADOS.includes(f.estado)) q = q.eq('status', f.estado);
      if (desde) q = q.gte('created_at', `${desde}T00:00:00-05:00`);
      // `hasta` es INCLUSIVO: quien escribe 31 de agosto espera que entren las de ese día.
      if (hasta) q = q.lte('created_at', `${hasta}T23:59:59-05:00`);
      if (busqueda) {
        // El término ya pasó por `terminoBuscable`, así que no puede traer la coma ni el paréntesis
        // que romperían la gramática del `or`. Los uuid son nuestros, salen de la consulta de
        // arriba.
        const porNumero = `full_number.ilike.*${busqueda}*`;
        q = q.or(
          pagadoresQueCoinciden.length > 0
            ? `${porNumero},payer_id.in.(${pagadoresQueCoinciden.join(',')})`
            : porNumero,
        );
      }
      return q
        .order('created_at', { ascending: false })
        .range((pagina - 1) * porPagina, pagina * porPagina - 1);
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
  const total = count ?? 0;
  const hayFiltro = Boolean(f.desde || f.hasta || f.tipo || f.estado || busqueda);
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  /** Conserva los filtros al cambiar de página o de tamaño. */
  function conFiltros(cambios: Record<string, string | undefined>): string {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      desde: f.desde,
      hasta: f.hasta,
      tipo: f.tipo,
      estado: f.estado,
      q: busqueda || undefined,
      n: String(porPagina),
      p: String(pagina),
      todo: verTodo ? '1' : undefined,
      ...cambios,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/dashboard/facturacion?${qs}` : '/dashboard/facturacion';
  }
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
          title="Ventas, recibos y facturas"
          description={`Documentos · ${monthLabel}`}
          actions={
            <>
              {/* EL MENÚ SE QUEDA, y no es un descuido de la copia.
                  En OkVet este `···` sólo trae «Unificador de cuentas» porque sus destinos
                  —administración, informes— viven en la barra de navegación global. Acá la barra
                  lateral tiene UNA entrada de Ventas y nada más, así que Finanzas, Cartera,
                  Inventario, Catálogo y Configuración sólo se alcanzan desde esta cabecera:
                  quitarlas dejaría cinco pantallas sin puerta. Subirlas a la barra lateral toca el
                  orden que definió Luciano el 19-ago, y esa no es una decisión de este cambio. */}
              <MenuDeVentas />
              {/* ABRE EL FORMULARIO, no un buscador. En OkVet «Registrar venta» abre la cuenta
                  con «Venta a persona indeterminada» puesta y un «Editar» para atarla a un cliente;
                  acá `mostrador=1` es exactamente ese estado. Antes el primer paso era una caja de
                  búsqueda, que es de lo que se quejó David: apretás «nueva factura» y no aparece
                  una factura.

                  EL RIESGO, DICHO: una cuenta sin cliente queda a nombre de consumidor final —
                  fuera de cartera y sin correo—. Por eso el «Editar» del formulario va al lado del
                  nombre y no escondido, y por eso el titular se puede atar en cualquier momento
                  antes de emitir. */}
              <Button render={<Link href="/dashboard/facturacion/nueva?mostrador=1" />}>
                <Plus aria-hidden />
                Registrar venta
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
            {/* Este aviso SÍ lleva al selector: viene de «hay consultas sin facturar», o sea que ya
                se sabe a quién se le cobra y lo que falta es elegir cuál. Es el único camino donde
                buscar es el punto, y no un peaje. */}
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
        {/* QUÉ SE ESTÁ MIRANDO, en letra grande y antes que los filtros. Sin esto, abrir en
            «hoy» se lee como que se perdieron las facturas viejas. */}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 font-medium text-fg">
            <CalendarDays className="size-3.5" aria-hidden />
            {verTodo
              ? 'Todo el histórico'
              : desde === hasta
                ? `Hoy: ${fmtDate(`${desde}T12:00:00-05:00`)}`
                : `${fmtDate(`${desde}T12:00:00-05:00`)} — ${fmtDate(`${hasta}T12:00:00-05:00`)}`}
          </span>
          {!verTodo && !f.desde && !f.hasta && (
            <Link
              href={conFiltros({ todo: '1', p: '1' })}
              className="text-fg-muted underline underline-offset-2 hover:text-fg"
            >
              Ver todo
            </Link>
          )}
          {verTodo && (
            <Link
              href={conFiltros({ todo: undefined, desde: undefined, hasta: undefined, p: '1' })}
              className="text-fg-muted underline underline-offset-2 hover:text-fg"
            >
              Volver a hoy
            </Link>
          )}
        </div>

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
              className={`${CONTROL} rounded-lg border border-line bg-surface px-2.5 text-[12.5px] text-fg`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-fg-muted">Hasta</span>
            <input
              type="date"
              name="hasta"
              defaultValue={f.hasta ?? ''}
              className={`${CONTROL} rounded-lg border border-line bg-surface px-2.5 text-[12.5px] text-fg`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-fg-muted">Documento</span>
            <select
              name="tipo"
              defaultValue={f.tipo ?? ''}
              className={`${CONTROL} rounded-lg border border-line bg-surface px-2.5 text-[12.5px] text-fg`}
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
              className={`${CONTROL} rounded-lg border border-line bg-surface px-2.5 text-[12.5px] text-fg`}
            >
              <option value="">Todos</option>
              <option value="BORRADOR">Borrador</option>
              <option value="EMITIDA">Emitida</option>
              <option value="ANULADA">Anulada</option>
            </select>
          </label>
          {/* Se arrastran para que filtrar no borre la búsqueda ni devuelva la página a 10. */}
          {busqueda && <input type="hidden" name="q" value={busqueda} />}
          {porPagina !== 10 && <input type="hidden" name="n" value={porPagina} />}
          {verTodo && <input type="hidden" name="todo" value="1" />}
          <Button type="submit" variant="outline" className={CONTROL}>
            Filtrar
          </Button>
          {hayFiltro && (
            <Link
              href="/dashboard/facturacion"
              className={`${CONTROL} self-end px-2 text-[12.5px] text-fg-muted underline underline-offset-2 hover:text-fg`}
            >
              Limpiar
            </Link>
          )}
        </FormularioDeFiltros>

        {/* ── Tabla de facturas ── */}
        <div className="mb-[14px] overflow-hidden rounded-lg border border-line-soft bg-card">
          {/* Barra de la tabla: cuántas filas a la izquierda, buscar a la derecha.
              «Mostrar» va como ENLACES y no como `select`: sin JavaScript un select no aplica solo,
              y en la referencia el cambio es inmediato. Un enlace navega y ya. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-3.5 py-2.5 text-[12.5px]">
            <div className="flex items-center gap-1.5 text-fg-muted">
              <span>Mostrar</span>
              {POR_PAGINA.map((n) => (
                <Link
                  key={n}
                  href={conFiltros({ n: String(n), p: '1' })}
                  aria-current={n === porPagina ? 'page' : undefined}
                  className={
                    n === porPagina
                      ? 'rounded-md bg-secondary px-2 py-0.5 font-medium text-fg'
                      : 'rounded-md px-2 py-0.5 hover:bg-accent'
                  }
                >
                  {n}
                </Link>
              ))}
              <span>registros</span>
            </div>
            <FormularioDeFiltros
              action="/dashboard/facturacion"
              className="flex items-center gap-2"
            >
              {/* Los filtros del rango viajan escondidos: buscar no debería descartar el rango que
                  la persona ya eligió. */}
              {f.desde && <input type="hidden" name="desde" value={f.desde} />}
              {f.hasta && <input type="hidden" name="hasta" value={f.hasta} />}
              {f.tipo && <input type="hidden" name="tipo" value={f.tipo} />}
              {f.estado && <input type="hidden" name="estado" value={f.estado} />}
              {verTodo && <input type="hidden" name="todo" value="1" />}
              {porPagina !== 10 && <input type="hidden" name="n" value={porPagina} />}
              <label htmlFor="buscar" className="text-fg-muted">
                Buscar:
              </label>
              <input
                id="buscar"
                name="q"
                type="search"
                defaultValue={busqueda}
                placeholder="Número o cliente"
                className={`${CONTROL} rounded-lg border border-line bg-surface px-2.5 text-[12.5px] text-fg placeholder:text-fg-faint`}
              />
            </FormularioDeFiltros>
          </div>
          {invoices.length === 0 ? (
            hayFiltro ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              {/* DOS VACÍOS DISTINTOS. "No hay facturas" cuando el filtro es el que no encuentra
                  nada se lee como que se perdieron los datos. */}
              <p className="text-base font-medium text-fg">Ninguna factura con esos filtros</p>
              <p className="max-w-sm text-sm text-fg-muted">
                {verTodo
                  ? 'Probá con otro rango de fechas, o quitá el tipo de documento y el estado.'
                  : 'La lista arranca en HOY. Mirá todo el histórico o cambiá el rango.'}
              </p>
              {!verTodo && (
                <Button render={<Link href={conFiltros({ todo: '1', p: '1' })} />} className="mt-2">
                  Ver todo el histórico
                </Button>
              )}
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
              {/* ABRE LA CUENTA, NO UN BUSCADOR. Por acá entró David el 25-ago —es el camino
                  natural de una clínica sin facturas— y cayó en el paso de búsqueda que «Registrar
                  venta» ya no usaba. Arreglar sólo el botón principal y dejar éste apuntando al
                  buscador era peor que no arreglar ninguno: el mismo módulo hacía dos cosas
                  distintas según por dónde entraras. */}
              <p className="max-w-sm text-sm text-fg-muted">
                Se abre lista para cobrar. Si la venta es de un titular, lo atás con «Editar» y
                seguís.
              </p>
              <Button
                render={<Link href="/dashboard/facturacion/nueva?mostrador=1" />}
                className="mt-2"
              >
                <Plus aria-hidden />
                Crear la primera factura
              </Button>
            </div>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
{/* LAS COLUMNAS SON LAS DE LA REFERENCIA, en su orden:
                    Opciones · Identificación/Cliente · Valor · Pagos · Estado · Usuario · Actualizado.
                    «Opciones» va primero y lleva el número del documento como etiqueta del enlace:
                    es a la vez el asa de la fila y el identificador fiscal, que en un libro de
                    ventas no se puede perder. */}
                <thead>
                  <tr>
                    <th className={TH}>Opciones</th>
                    <th className={TH}>Identificación/Cliente</th>
                    <th className={TH_DER}>Valor</th>
                    <th className={TH_DER}>Pagos</th>
                    <th className={TH}>Estado</th>
                    <th className={TH}>Usuario</th>
                    <th className={TH}>Actualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <TrLink
                      key={i.id}
                      href={`/dashboard/facturacion/${i.id}`}
                      className="border-b border-line-soft transition-colors last:border-0 hover:bg-accent"
                    >
                      <td className={`${TD_NUM} text-left font-medium`}>
                        <Link
                          href={`/dashboard/facturacion/${i.id}`}
                          className="text-fg underline-offset-2 hover:underline"
                        >
                          {i.full_number ?? `Borrador · ${i.doc_kind === 'POS' ? 'POS' : 'FV'}`}
                        </Link>
                      </td>
                      <td className={TD}>
                        <span className="block font-semibold text-fg">
                          {i.payer?.name ?? 'Venta a persona indeterminada'}
                        </span>
                        {i.payer?.doc_number && (
                          <span className="block font-mono text-[11px] tabular-nums text-fg-faint">
                            {i.payer.doc_type ?? 'CC'} {i.payer.doc_number}
                          </span>
                        )}
                      </td>
                      <td className={`${TD_NUM} text-fg`}>
                        {formatCOP(i.total_cents)}
                      </td>
                      <td className={`${TD_NUM} text-fg-muted`}>
                        {/* Lo PAGADO, no el saldo: es la columna «Pagos» de la referencia. El saldo
                            se lee restando, y en un borrador todavía no hay nada que pagar. */}
                        {i.status === 'EMITIDA' ? formatCOP(i.paid_cents) : '—'}
                      </td>
                      <td className={TD}>
                        <span className="inline-flex flex-wrap gap-1">
                          <LifecycleBadge status={i.status} />
                          <FiscalBadge status={i.fiscal_status} />
                          {i.status === 'EMITIDA' && (
                            <>
                              <CollectionBadge status={i.collection_status} />
                              <DeliveryBadge status={i.delivery_status} />
                            </>
                          )}
                        </span>
                      </td>
                      <td className={`${TD} text-fg-muted`}>
                        {i.usuario?.full_name ?? '—'}
                      </td>
                      <td className={`${TD_NUM} text-fg-muted`}>
                        {fmtDateTime(i.updated_at)}
                      </td>
                    </TrLink>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginación: `Anterior` · `Siguiente`, como la referencia. Van como enlaces para que la
              pantalla siga siendo de servidor y para que una página se pueda compartir. */}
          {total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-3.5 py-2.5 text-[12.5px] text-fg-muted">
              <span>
                {`Mostrando ${(pagina - 1) * porPagina + 1} a ${Math.min(pagina * porPagina, total)} de ${total} ${total === 1 ? 'registro' : 'registros'}`}
              </span>
              <div className="flex items-center gap-1.5">
                {pagina > 1 ? (
                  <Link
                    href={conFiltros({ p: String(pagina - 1) })}
                    className="rounded-md border border-line-soft px-2.5 py-1 hover:bg-accent"
                  >
                    Anterior
                  </Link>
                ) : (
                  <span className="rounded-md border border-line-soft px-2.5 py-1 opacity-50">
                    Anterior
                  </span>
                )}
                {pagina < ultimaPagina ? (
                  <Link
                    href={conFiltros({ p: String(pagina + 1) })}
                    className="rounded-md border border-line-soft px-2.5 py-1 hover:bg-accent"
                  >
                    Siguiente
                  </Link>
                ) : (
                  <span className="rounded-md border border-line-soft px-2.5 py-1 opacity-50">
                    Siguiente
                  </span>
                )}
              </div>
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

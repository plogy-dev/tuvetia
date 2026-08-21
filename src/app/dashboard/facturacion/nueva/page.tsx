import Link from 'next/link';
import { ArrowLeft, Search, ShoppingBag, Stethoscope } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import {
  getBillingSettings,
  getUnbilledConsultations,
  listCatalogItems,
} from '@/lib/facturacion/queries';
import { DEFAULT_UVT_VALUE_CENTS } from '@/lib/facturacion/constants';
import { fmtDate } from '@/lib/facturacion/format';
import { InvoiceCart } from '@/components/facturacion/InvoiceCart';
import { sugerirRenglones } from '@/lib/facturacion/lo-recetado';
import { FormularioDeFiltros } from "@/components/ui/formulario-de-filtros"

export const metadata = { title: "Nueva factura · Tuvetia" }


export const dynamic = 'force-dynamic';

type SearchParams = Promise<{
  q?: string;
  ownerId?: string;
  ownerName?: string;
  patientId?: string;
  patientName?: string;
  consultationId?: string;
  mostrador?: string;
}>;

type PatientHit = {
  id: string;
  name: string;
  species: string;
  owner_id: string;
  owner: { full_name: string } | null;
};

// `document_id`, no `id_doc`: ése es el nombre de la columna en NUESTRO esquema. `id_doc` es como
// lo llamaba el repo del cliente (está anotado en `lib/supabase/types.ts`), y se coló acá.
type OwnerHit = { id: string; full_name: string; document_id: string | null; phone: string | null };

export default async function NuevaFacturaPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const showCart = Boolean(sp.ownerId || sp.mostrador);
  const q = sp.q?.trim() ?? '';

  // Una sola ola: settings, catálogo y consultas sin facturar no dependen entre
  // sí (los gates `showCart`/`q` salen del searchParams, no de settings).
  const [settings, items, unbilled, notaDeLaConsulta] = await Promise.all([
    getBillingSettings(supabase, clinicId),
    showCart ? listCatalogItems(supabase, clinicId) : Promise.resolve([]),
    !showCart && !q
      ? getUnbilledConsultations(supabase, clinicId)
      : Promise.resolve([]),
    // EL PLAN DE LA CONSULTA, si se vino desde una. SÓLO la nota APROBADA: cobrar a partir de un
    // borrador que nadie firmó sería facturar lo que todavía se puede cambiar.
    showCart && sp.consultationId
      ? supabase
          .from('clinical_notes')
          .select('plan')
          .eq('clinic_id', clinicId)
          .eq('consultation_id', sp.consultationId)
          .eq('status', 'approved')
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Lo recetado, cruzado con el catálogo. Sin nota aprobada o sin nada cobrable en el plan queda
  // vacío y el carrito arranca como siempre — el camino de la factura suelta no cambia.
  const renglonesIniciales = sugerirRenglones(
    (notaDeLaConsulta as { data: { plan: string | null } | null }).data?.plan ?? null,
    items.map((i) => ({ id: i.id, name: i.name, price_cents: i.price_cents, tax_rate: i.tax_rate })),
  );
  const active = settings?.module_status === 'ACTIVO';

  // ── Paso carrito ──────────────────────────────────────────────────────────
  if (active && showCart) {
    return (
      <section className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-4xl px-8 py-10">
          <header className="mb-6">
            <Link
              href="/dashboard/facturacion/nueva"
              className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Cambiar cliente
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Nueva factura</h1>
          </header>
          {items.length === 0 && (
            <p className="mb-5 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
              Tu catálogo está vacío — puedes facturar con líneas libres, o{' '}
              <Link href="/dashboard/facturacion/inventario" className="underline underline-offset-2">
                crear servicios y productos
              </Link>{' '}
              para agilizar.
            </p>
          )}
          <InvoiceCart
            items={items}
            ownerId={sp.ownerId}
            ownerName={sp.ownerName}
            patientId={sp.patientId}
            patientName={sp.patientName}
            consultationId={sp.consultationId}
            renglonesIniciales={renglonesIniciales}
            defaultDocKind={settings?.default_doc_kind ?? 'POS'}
            uvtValueCents={settings?.uvt_value_cents ?? DEFAULT_UVT_VALUE_CENTS}
            defaultTermsDays={settings?.default_payment_terms_days ?? 15}
            reminderChannel={settings?.reminder_channel ?? 'WHATSAPP'}
            remindersEnabled={settings?.reminders_enabled ?? false}
          />
        </div>
      </section>
    );
  }

  // ── Paso búsqueda ─────────────────────────────────────────────────────────
  let patients: PatientHit[] = [];
  let owners: OwnerHit[] = [];
  if (active && q) {
    // Ni `owners` ni `patients` tienen `deleted_at` — no hay borrado suave en el esquema. Con ese
    // filtro puesto, PostgREST respondía 42703 y las DOS búsquedas devolvían cero resultados
    // SIEMPRE: el vet no podía vincular a nadie y la factura caía en "consumidor final", o sea sin
    // pagador real, fuera de cartera y sin correo. Verificado contra el principal.
    const [pRes, oRes] = await Promise.all([
      supabase
        .from('patients')
        .select('id, name, species, owner_id, owner:owners(full_name)')
        .eq('clinic_id', clinicId)
        .ilike('name', `%${q}%`)
        .limit(8),
      supabase
        .from('owners')
        .select('id, full_name, document_id, phone')
        .eq('clinic_id', clinicId)
        // El argumento de .or() es GRAMÁTICA de filtros PostgREST, no un valor: una coma o un
        // paréntesis en `q` inyectaría condiciones arbitrarias (la tenancy no se escapa — el
        // .eq(clinic_id) es un AND aparte — pero sí la semántica de la búsqueda). Se quitan los
        // metacaracteres; para nombres/cédulas/teléfonos no son entrada legítima.
        .or(
          ['full_name', 'document_id', 'phone']
            .map((col) => `${col}.ilike.%${q.replace(/[,()"\\]/g, ' ')}%`)
            .join(','),
        )
        .limit(8),
    ]);
    // Leer `error` es lo que más importa de este arreglo. El `?? []` de abajo convierte cualquier
    // fallo en "no hay resultados", que es indistinguible de la verdad — por eso una columna
    // inexistente pudo pasar desapercibida. Es el tercer caso de este mismo patrón esta semana.
    if (pRes.error) console.error('nueva factura · búsqueda de pacientes:', pRes.error);
    if (oRes.error) console.error('nueva factura · búsqueda de titulares:', oRes.error);
    patients = (pRes.data as unknown as PatientHit[]) ?? [];
    owners = (oRes.data as OwnerHit[]) ?? [];
  }

  return (
    <section className="flex-1 min-w-0">
      <div className="mx-auto w-full max-w-3xl px-8 py-10">
        <header className="mb-6">
          <Link
            href="/dashboard/facturacion"
            className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Facturación
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Nueva factura</h1>
          <p className="mt-1 text-sm text-fg-faint">
            Busca el paciente o el titular, o registra una venta de mostrador.
          </p>
        </header>

        {!active ? (
          <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
            El módulo no está activo.{' '}
            <Link href="/dashboard/facturacion/configuracion" className="underline underline-offset-2">
              Configúralo primero
            </Link>
            .
          </p>
        ) : (
          <>
            <FormularioDeFiltros action="/dashboard/facturacion/nueva" className="mb-4 flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint"
                  aria-hidden
                />
                <input
                  name="q"
                  defaultValue={q}
                  autoFocus
                  placeholder="Nombre de la mascota, del titular, cédula o celular…"
                  className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-faint outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-deep transition"
              >
                Buscar
              </button>
            </FormularioDeFiltros>

            <Link
              href="/dashboard/facturacion/nueva?mostrador=1"
              className="mb-6 inline-flex items-center gap-2 text-sm text-fg-muted underline-offset-2 hover:text-fg hover:underline"
            >
              <ShoppingBag className="size-4" aria-hidden />
              Venta de mostrador (consumidor final, sin cliente)
            </Link>

            {/* Puente CRM: consultas cerradas que aún nadie facturó */}
            {!q && unbilled.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-faint">
                  <Stethoscope className="size-3.5" aria-hidden />
                  Consultas recientes sin facturar ({unbilled.length})
                </h2>
                <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                  {unbilled.map((c) => (
                    <li key={c.consultationId}>
                      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-fg">
                            {c.patientName}
                            {c.patientSpecies ? (
                              <span className="font-normal text-fg-faint"> ({c.patientSpecies})</span>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-fg-muted">
                            {c.ownerName} · consulta del {fmtDate(c.startedAt)}
                          </p>
                        </div>
                        <Link
                          href={{
                            pathname: '/dashboard/facturacion/nueva',
                            query: {
                              ownerId: c.ownerId,
                              ownerName: c.ownerName,
                              patientId: c.patientId,
                              patientName: c.patientName,
                              consultationId: c.consultationId,
                            },
                          }}
                          className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-on-brand hover:bg-brand-deep transition"
                        >
                          Facturar
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-fg-faint">
                  Cerradas en los últimos 60 días sin factura asociada. Al facturarlas
                  quedan ligadas a la consulta y desaparecen de esta lista.
                </p>
              </section>
            )}

            {q && patients.length === 0 && owners.length === 0 && (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-fg-faint">
                Sin resultados para «{q}».
              </p>
            )}

            {patients.length > 0 && (
              <section className="mb-5">
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-faint">
                  Pacientes
                </h2>
                <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                  {patients.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={{
                          pathname: '/dashboard/facturacion/nueva',
                          query: {
                            ownerId: p.owner_id,
                            ownerName: p.owner?.full_name ?? '',
                            patientId: p.id,
                            patientName: p.name,
                          },
                        }}
                        className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-2 transition"
                      >
                        <span className="font-medium text-fg">
                          {p.name} <span className="font-normal text-fg-faint">({p.species})</span>
                        </span>
                        <span className="text-fg-muted">{p.owner?.full_name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {owners.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-faint">
                  Titulares
                </h2>
                <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                  {owners.map((o) => (
                    <li key={o.id}>
                      <Link
                        href={{
                          pathname: '/dashboard/facturacion/nueva',
                          query: { ownerId: o.id, ownerName: o.full_name },
                        }}
                        className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-2 transition"
                      >
                        <span className="font-medium text-fg">{o.full_name}</span>
                        <span className="text-fg-muted">{o.document_id ?? o.phone ?? ''}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}

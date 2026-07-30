import Link from 'next/link';
import { ArrowLeft, Boxes, FileUp } from 'lucide-react';
import { requireClinicPage } from '@/lib/facturacion/page-auth';
import {
  ensureDefaultCategories,
  getBillingSettings,
  listCatalogItems,
  listCategories,
  listSuppliers,
} from '@/lib/facturacion/queries';
import { CatalogItemsTab } from '@/components/facturacion/CatalogItemsTab';
import { CategoryManager } from '@/components/facturacion/CategoryManager';

export const dynamic = 'force-dynamic';

type Tab = 'productos' | 'servicios' | 'categorias';
const TABS: { key: Tab; label: string }[] = [
  { key: 'productos', label: 'Productos' },
  { key: 'servicios', label: 'Servicios' },
  { key: 'categorias', label: 'Categorías' },
];

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'productos';

  // Verificación local del JWT (sin round-trip) — patrón getCachedUser.
  const ctx = await requireClinicPage();
  if (!ctx) return null;
  const { supabase, clinicId } = ctx;

  const settings = await getBillingSettings(supabase, clinicId);
  if (settings?.module_status !== 'ACTIVO') {
    return (
      <main className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-4xl px-8 py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Catálogo</h1>
          <p className="mt-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
            El módulo no está activo.{' '}
            <Link href="/dashboard/facturacion/configuracion" className="underline underline-offset-2">
              Configúralo primero
            </Link>
            .
          </p>
        </div>
      </main>
    );
  }

  await ensureDefaultCategories(supabase, clinicId);

  const [items, categories, categoriesAll, suppliers] = await Promise.all([
    listCatalogItems(supabase, clinicId, { includeInactive: true }),
    listCategories(supabase, clinicId),
    listCategories(supabase, clinicId, { includeArchived: true }),
    listSuppliers(supabase, clinicId, { includeInactive: true }),
  ]);

  const productos = items.filter((i) => i.item_type !== 'SERVICIO');
  const servicios = items.filter((i) => i.item_type === 'SERVICIO');
  // Componentes disponibles para recetas: ítems activos que no son servicios.
  const recipeComponents = items
    .filter((i) => i.item_type !== 'SERVICIO' && i.active)
    .map((i) => ({ id: i.id, name: i.name, use_unit: i.use_unit }));

  return (
    <main className="flex-1 min-w-0">
      <div className="mx-auto w-full max-w-4xl px-8 py-10">
        <header className="mb-6">
          <Link
            href="/dashboard/facturacion/inventario"
            className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Inventario
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg">
            <Boxes className="size-6 text-fg-muted" aria-hidden />
            Catálogo
          </h1>
          <p className="mt-1 text-sm text-fg-faint">
            Servicios, productos y categorías de tu práctica. Editable en cualquier momento.
          </p>
        </header>

        <nav className="mb-5 flex gap-1 border-b border-line">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/dashboard/facturacion/catalogo?tab=${t.key}`}
              className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
                tab === t.key
                  ? 'border-brand font-medium text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {tab === 'productos' && (
          <CatalogItemsTab
            items={productos}
            categories={categories}
            defaultType="PRODUCTO"
            suppliers={suppliers}
          />
        )}
        {tab === 'servicios' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Link
                href="/dashboard/facturacion/inventario/importar?preset=servicios"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg-muted hover:border-brand hover:text-fg transition"
              >
                <FileUp className="size-4" aria-hidden />
                Importar servicios (Excel o foto)
              </Link>
            </div>
            <CatalogItemsTab
              items={servicios}
              categories={categories}
              defaultType="SERVICIO"
              recipeComponents={recipeComponents}
            />
          </div>
        )}
        {tab === 'categorias' && <CategoryManager categories={categoriesAll} />}
      </div>
    </main>
  );
}

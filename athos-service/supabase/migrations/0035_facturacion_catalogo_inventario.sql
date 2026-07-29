-- ─────────────────────────────────────────────────────────────────────────────
-- Tuvetia · Facturación — catálogo e inventario (port multi-tenant por clínica)
-- Consolida tres migraciones del repo origen:
--   • 0024_facturacion_import — importación de catálogo desde Excel/CSV con
--     vista previa y reversión: cargar → mapear columnas → validar → preview →
--     confirmar → (revertir).
--   • 0027_catalog_categories — categorías de inventario/catálogo como DATOS
--     (no enum rígido): cada clínica tiene su propio set, editable y archivable.
--   • 0028_service_consumptions — recetas de consumo (servicio → componentes):
--     al emitir una factura con un servicio, sus componentes con control de
--     stock se descuentan del inventario.
--
-- Adaptaciones del port: tenancy clinic_id + autoría created_by (criterio de
-- 0029); sin organization_id; sin grants de tabla (RLS estándar del repo).
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ Importación de inventario (origen 0024_facturacion_import) ══════════════

-- import_batches traza cada importación; catalog_items e inventory_movements
-- ganan un import_batch_id nullable (aditivo) para poder revertir en bloque
-- mientras nada posterior dependa de lo importado.
create table if not exists public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,

  file_name   text not null,
  status      text not null default 'PREVIEW'
                check (status in ('PREVIEW', 'COMMITTED', 'REVERTED')),
  -- columna origen → campo destino (elegido por la clínica sobre la propuesta)
  mapping     jsonb not null default '{}'::jsonb,
  -- { columns: string[], raw: fila[], validated: ValidatedRow[] }
  rows        jsonb not null default '{}'::jsonb,
  -- { total, ready, withWarnings, duplicates, errors }
  report      jsonb not null default '{}'::jsonb,

  committed_at timestamptz,
  reverted_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists import_batches_clinic_created_idx
  on public.import_batches (clinic_id, created_at desc);

drop trigger if exists import_batches_touch_updated_at on public.import_batches;
create trigger import_batches_touch_updated_at
  before update on public.import_batches
  for each row execute function public.touch_updated_at();

alter table public.import_batches enable row level security;

drop policy if exists "import_batches_select" on public.import_batches;
create policy "import_batches_select"
  on public.import_batches for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "import_batches_insert" on public.import_batches;
create policy "import_batches_insert"
  on public.import_batches for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "import_batches_update" on public.import_batches;
create policy "import_batches_update"
  on public.import_batches for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "import_batches_delete" on public.import_batches;
create policy "import_batches_delete"
  on public.import_batches for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── Vínculo aditivo: qué creó cada importación ──────────────────────────────
alter table public.catalog_items
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;

alter table public.inventory_movements
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;

create index if not exists catalog_items_import_batch_idx
  on public.catalog_items (import_batch_id)
  where import_batch_id is not null;

create index if not exists inventory_movements_import_batch_idx
  on public.inventory_movements (import_batch_id)
  where import_batch_id is not null;


-- ═══ Categorías de catálogo (origen 0027_catalog_categories) ═════════════════

-- Las categorías son DATOS, no un enum rígido. Backfill: cada clínica con
-- catálogo recibe una categoría por defecto «Sin categoría» y sus ítems sin
-- categoría quedan asignados a ella (así el panel por categorías nunca deja
-- ítems sueltos). El «archivar» de ítems reutiliza catalog_items.active.
create table if not exists public.catalog_categories (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  name        text not null,
  parent_id   uuid references public.catalog_categories(id) on delete set null,
  sort_order  int  not null default 0,
  is_default  boolean not null default false,          -- «Sin categoría»
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists catalog_categories_clinic_sort_idx
  on public.catalog_categories (clinic_id, sort_order);

-- Nombre único por clínica (case-insensitive) entre las vigentes.
create unique index if not exists catalog_categories_clinic_name_uidx
  on public.catalog_categories (clinic_id, lower(name))
  where archived_at is null;

drop trigger if exists catalog_categories_touch_updated_at on public.catalog_categories;
create trigger catalog_categories_touch_updated_at
  before update on public.catalog_categories
  for each row execute function public.touch_updated_at();

alter table public.catalog_categories enable row level security;

drop policy if exists "catalog_categories_select" on public.catalog_categories;
create policy "catalog_categories_select"
  on public.catalog_categories for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "catalog_categories_insert" on public.catalog_categories;
create policy "catalog_categories_insert"
  on public.catalog_categories for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "catalog_categories_update" on public.catalog_categories;
create policy "catalog_categories_update"
  on public.catalog_categories for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "catalog_categories_delete" on public.catalog_categories;
create policy "catalog_categories_delete"
  on public.catalog_categories for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── catalog_items: categoría + campos de servicio/producto ──────────────────
alter table public.catalog_items
  add column if not exists category_id       uuid references public.catalog_categories(id) on delete set null,
  add column if not exists duration_minutes  int,           -- servicios
  add column if not exists barcode           text,          -- productos/insumos
  add column if not exists active_ingredient text,          -- medicamentos
  add column if not exists concentration     text,          -- medicamentos
  add column if not exists presentation      text,          -- medicamentos/productos
  add column if not exists manufacturer      text;

create index if not exists catalog_items_clinic_category_idx
  on public.catalog_items (clinic_id, category_id);

-- ─── Backfill: «Sin categoría» por clínica con catálogo + asignación ─────────
insert into public.catalog_categories (clinic_id, name, is_default, sort_order)
select distinct ci.clinic_id, 'Sin categoría', true, 999
from public.catalog_items ci
where not exists (
  select 1 from public.catalog_categories cc
  where cc.clinic_id = ci.clinic_id and cc.is_default = true
);

update public.catalog_items ci
set category_id = cc.id
from public.catalog_categories cc
where cc.clinic_id = ci.clinic_id
  and cc.is_default = true
  and ci.category_id is null;


-- ═══ Recetas de consumo (origen 0028_service_consumptions) ═══════════════════

-- Una "receta" es la lista de materiales que consume un SERVICIO: al emitir una
-- factura con ese servicio, sus componentes (productos/medicamentos con control
-- de stock) se descuentan del inventario. La clínica arma la receta a mano o
-- subiendo una imagen/Excel/texto que la IA transcribe a un BORRADOR — pero la
-- receta solo se crea cuando la clínica la confirma (la IA nunca escribe stock
-- ni recetas sola).
--
-- Modelo: una fila por (servicio, componente). La receta de un servicio = todas
-- sus filas.
create table if not exists public.service_consumptions (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  created_by    uuid references public.profiles(id) on delete set null,
  service_id    uuid not null references public.catalog_items(id) on delete cascade,
  component_id  uuid not null references public.catalog_items(id) on delete cascade,
  qty           numeric(12,4) not null check (qty > 0),    -- en use_unit del componente
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Un componente aparece una sola vez por receta (edita la cantidad, no duplica).
create unique index if not exists service_consumptions_uidx
  on public.service_consumptions (clinic_id, service_id, component_id);

create index if not exists service_consumptions_service_idx
  on public.service_consumptions (service_id);

drop trigger if exists service_consumptions_touch_updated_at on public.service_consumptions;
create trigger service_consumptions_touch_updated_at
  before update on public.service_consumptions
  for each row execute function public.touch_updated_at();

alter table public.service_consumptions enable row level security;

drop policy if exists "service_consumptions_select" on public.service_consumptions;
create policy "service_consumptions_select"
  on public.service_consumptions for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "service_consumptions_insert" on public.service_consumptions;
create policy "service_consumptions_insert"
  on public.service_consumptions for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "service_consumptions_update" on public.service_consumptions;
create policy "service_consumptions_update"
  on public.service_consumptions for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "service_consumptions_delete" on public.service_consumptions;
create policy "service_consumptions_delete"
  on public.service_consumptions for delete
  using (clinic_id = (select private.my_clinic_id()));

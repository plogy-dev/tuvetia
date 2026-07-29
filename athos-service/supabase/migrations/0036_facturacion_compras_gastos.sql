-- ─────────────────────────────────────────────────────────────────────────────
-- Tuvetia · Facturación — compras y gastos (port multi-tenant por clínica)
-- Consolida tres migraciones del repo origen:
--   • 0029_suppliers — proveedores como entidad (antes texto libre en
--     catalog_items.supplier) + backfill best-effort desde el texto existente.
--   • 0030_expenses  — egresos: los INGRESOS son los payments existentes (no se
--     duplican); esto crea solo el lado de EGRESOS con categorías en catálogo
--     CERRADO (CHECK).
--   • 0031_purchases — compras a proveedores: entrada de inventario CON monto.
--
-- Adaptaciones del port: tenancy clinic_id + autoría created_by (criterio de
-- 0029-destino); sin organization_id; sin grants de tabla (RLS estándar).
-- Comprobantes de egreso: NO se crea un bucket aparte (el origen tenía
-- expense-receipts) — van al bucket privado `receipts` creado en 0030-destino,
-- bajo el path <clinic_id>/expenses/{uuid}.{ext}.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ Proveedores (origen 0029_suppliers) ═════════════════════════════════════

-- Hasta ahora el proveedor era texto libre en catalog_items.supplier. Se crea
-- `suppliers` (por clínica, RLS), se añade `supplier_id` a catalog_items y se
-- hace un backfill best-effort desde el texto existente (get-or-create por
-- nombre case-insensitive). El texto `supplier` se CONSERVA como
-- fallback/display para ítems históricos.
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  name        text not null,
  nit         text,
  phone       text,
  email       text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Nombre único por clínica (case-insensitive) entre los activos.
create unique index if not exists suppliers_clinic_name_uidx
  on public.suppliers (clinic_id, lower(name))
  where active;

drop trigger if exists suppliers_touch_updated_at on public.suppliers;
create trigger suppliers_touch_updated_at
  before update on public.suppliers
  for each row execute function public.touch_updated_at();

alter table public.suppliers enable row level security;

drop policy if exists "suppliers_select" on public.suppliers;
create policy "suppliers_select"
  on public.suppliers for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "suppliers_insert" on public.suppliers;
create policy "suppliers_insert"
  on public.suppliers for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "suppliers_update" on public.suppliers;
create policy "suppliers_update"
  on public.suppliers for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "suppliers_delete" on public.suppliers;
create policy "suppliers_delete"
  on public.suppliers for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── catalog_items.supplier_id ───────────────────────────────────────────────
alter table public.catalog_items
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists catalog_items_clinic_supplier_idx
  on public.catalog_items (clinic_id, supplier_id);

-- ─── Backfill best-effort desde el texto libre existente ─────────────────────
insert into public.suppliers (clinic_id, name)
select distinct ci.clinic_id, trim(ci.supplier)
from public.catalog_items ci
where ci.supplier is not null
  and trim(ci.supplier) <> ''
  and not exists (
    select 1 from public.suppliers s
    where s.clinic_id = ci.clinic_id
      and lower(s.name) = lower(trim(ci.supplier))
  );

update public.catalog_items ci
set supplier_id = s.id
from public.suppliers s
where ci.supplier_id is null
  and ci.supplier is not null
  and trim(ci.supplier) <> ''
  and s.clinic_id = ci.clinic_id
  and lower(s.name) = lower(trim(ci.supplier));


-- ═══ Egresos (origen 0030_expenses) ══════════════════════════════════════════

-- Panel de ingresos y egresos: los INGRESOS son los `payments` existentes;
-- esta tabla es solo el lado de EGRESOS. Categorías de gasto en catálogo
-- CERRADO (CHECK); ampliar después es un drop/add de constraint. `purchase_id`
-- (más abajo) liga el egreso automático de una compra.
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,
  category        text not null check (category in (
    'COMPRA_INVENTARIO','NOMINA','ARRIENDO','SERVICIOS_PUBLICOS','HONORARIOS',
    'IMPUESTOS','MANTENIMIENTO','PUBLICIDAD','BANCARIOS','OTRO'
  )),
  amount_cents    bigint not null check (amount_cents > 0),
  expense_date    date not null default current_date,
  -- Mismos métodos que payments (0029 + 0030 destino).
  method          text not null check (method in (
    'EFECTIVO','TRANSFERENCIA','NEQUI','DAVIPLATA','TARJETA','ENLACE','OTRO'
  )),
  supplier_id     uuid references public.suppliers(id) on delete set null,
  note            text,
  -- Comprobante en el bucket `receipts`: <clinic_id>/expenses/{uuid}.{ext}
  attachment_path text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists expenses_clinic_date_idx
  on public.expenses (clinic_id, expense_date desc);
create index if not exists expenses_clinic_category_idx
  on public.expenses (clinic_id, category);

drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();

alter table public.expenses enable row level security;

drop policy if exists "expenses_select" on public.expenses;
create policy "expenses_select"
  on public.expenses for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "expenses_insert" on public.expenses;
create policy "expenses_insert"
  on public.expenses for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "expenses_update" on public.expenses;
create policy "expenses_update"
  on public.expenses for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "expenses_delete" on public.expenses;
create policy "expenses_delete"
  on public.expenses for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ═══ Compras a proveedores (origen 0031_purchases) ═══════════════════════════

-- Una compra registra la entrada de inventario CON monto: al confirmarla se
-- generan movimientos ENTRADA_COMPRA (ref_type='PURCHASE'), lotes si aplica,
-- se actualiza el costo del ítem (regla «último costo») y se crea el egreso
-- automático en expenses (categoría COMPRA_INVENTARIO, 1:1 vía purchase_id).
-- Anular la compra borra sus movimientos y su egreso.
--
-- qty de purchase_items va en unidad de COMPRA del ítem; el movimiento de
-- inventario se convierte a unidad de uso con conversion_factor (dominio).
create table if not exists public.purchases (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  created_by    uuid references public.profiles(id) on delete set null,
  supplier_id   uuid references public.suppliers(id) on delete set null,
  purchased_on  date not null default current_date,
  doc_number    text,                                   -- nº factura del proveedor
  status        text not null default 'BORRADOR'
                  check (status in ('BORRADOR','CONFIRMADA','ANULADA')),
  total_cents   bigint not null default 0 check (total_cents >= 0),
  method        text check (method in (
    'EFECTIVO','TRANSFERENCIA','NEQUI','DAVIPLATA','TARJETA','ENLACE','OTRO'
  )),
  note          text,
  confirmed_at  timestamptz,
  annulled_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists purchases_clinic_date_idx
  on public.purchases (clinic_id, purchased_on desc);
create index if not exists purchases_clinic_status_idx
  on public.purchases (clinic_id, status);

drop trigger if exists purchases_touch_updated_at on public.purchases;
create trigger purchases_touch_updated_at
  before update on public.purchases
  for each row execute function public.touch_updated_at();

alter table public.purchases enable row level security;

drop policy if exists "purchases_select" on public.purchases;
create policy "purchases_select"
  on public.purchases for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "purchases_insert" on public.purchases;
create policy "purchases_insert"
  on public.purchases for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "purchases_update" on public.purchases;
create policy "purchases_update"
  on public.purchases for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "purchases_delete" on public.purchases;
create policy "purchases_delete"
  on public.purchases for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── purchase_items ──────────────────────────────────────────────────────────
-- clinic_id directo (RLS simple por clínica, sin EXISTS a purchases — igual
-- que el diseño del origen, que le daba tenant directo).
create table if not exists public.purchase_items (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics(id) on delete cascade,
  purchase_id      uuid not null references public.purchases(id) on delete cascade,
  catalog_item_id  uuid not null references public.catalog_items(id) on delete restrict,
  qty              numeric(12,4) not null check (qty > 0),   -- en unidad de COMPRA
  unit_cost_cents  bigint not null check (unit_cost_cents >= 0), -- por unidad de compra
  lot_code         text,
  expires_on       date,
  created_at       timestamptz not null default now()
);

create index if not exists purchase_items_purchase_idx
  on public.purchase_items (purchase_id);
create index if not exists purchase_items_clinic_idx
  on public.purchase_items (clinic_id);

alter table public.purchase_items enable row level security;

drop policy if exists "purchase_items_select" on public.purchase_items;
create policy "purchase_items_select"
  on public.purchase_items for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "purchase_items_insert" on public.purchase_items;
create policy "purchase_items_insert"
  on public.purchase_items for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "purchase_items_update" on public.purchase_items;
create policy "purchase_items_update"
  on public.purchase_items for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "purchase_items_delete" on public.purchase_items;
create policy "purchase_items_delete"
  on public.purchase_items for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── inventory_movements: ref_type admite PURCHASE ───────────────────────────
alter table public.inventory_movements
  drop constraint if exists inventory_movements_ref_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_ref_type_check
  check (ref_type in ('INVOICE','IMPORT_BATCH','MANUAL','PURCHASE'));

-- ─── expenses: egreso automático 1:1 con la compra ───────────────────────────
alter table public.expenses
  add column if not exists purchase_id uuid references public.purchases(id) on delete set null;

create unique index if not exists expenses_purchase_uidx
  on public.expenses (purchase_id)
  where purchase_id is not null;

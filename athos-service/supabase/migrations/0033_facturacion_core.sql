-- ─────────────────────────────────────────────────────────────────────────────
-- Tuvetia · Facturación v1 (núcleo) — port multi-tenant por clínica
-- Módulo de facturación electrónica colombiana: configuración del emisor,
-- rangos de numeración DIAN, pagadores, catálogo de servicios/productos,
-- inventario por movimientos, facturas por eventos, documentos fiscales,
-- notas crédito y pagos manuales.
--
-- Adaptación del 0021_facturacion_core del repo origen al patrón de este repo:
--   • Tenancy: user_id (auth.users) → clinic_id (public.clinics). Policies RLS
--     con `clinic_id = (select private.my_clinic_id())`; tablas hijas sin
--     clinic_id directo validan vía EXISTS contra el padre.
--   • Atribución: el user_id del origen hacía doble papel (tenant + autor).
--     Aquí la autoría se separa en `created_by uuid references public.profiles`
--     (nullable, on delete set null) — nunca se pierde quién creó/emitió.
--   • organization_id (reservado org-mode del origen) NO se porta: clinic_id
--     ya ES el tenant multi-usuario en este repo.
--   • text+CHECK en vez de enums, dinero SIEMPRE en centavos (bigint).
--
-- Marco regulatorio (Res. DIAN 000165/2023). Reglas clave modeladas:
--   • El consecutivo se asigna de un rango de numeración autorizado y NUNCA se
--     reutiliza (facturacion_assign_next_number es atómica y solo avanza).
--   • Una factura emitida no se borra: se afecta con nota crédito.
--   • invoice_events es la fuente de verdad; los estados fiscal/recaudo/entrega
--     de invoices son cachés recalculados con deriveStatus (dominio).
--   • XML/CUFE se conservan ≥5 años (fiscal_documents + storage en fase 1f).
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── touch_updated_at (helper de triggers; el repo no lo tenía) ──────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Función de trigger: nadie la llama por RPC (mismo criterio que 0022).
revoke execute on function public.touch_updated_at() from public, anon, authenticated;


-- ─── billing_settings (configuración del emisor, 1 fila por clínica) ─────────
-- Los consecutivos NO viven acá: van en numbering_ranges (la resolución DIAN
-- real).
create table if not exists public.billing_settings (
  id                      uuid primary key default gen_random_uuid(),
  clinic_id               uuid not null references public.clinics(id) on delete cascade,
  created_by              uuid references public.profiles(id) on delete set null,

  module_status           text not null default 'NO_ACTIVADO'
                            check (module_status in
                              ('NO_ACTIVADO', 'RECORDAR_DESPUES', 'ASISTENTE_EN_PROGRESO', 'ACTIVO')),
  wizard_state            jsonb,

  billing_enabled         boolean not null default false,
  inventory_enabled       boolean not null default false,
  reminders_enabled       boolean not null default false,

  -- Datos fiscales del emisor (la clínica). fiscal_id_number = NIT o cédula.
  fiscal_name             text,
  fiscal_id_type          text check (fiscal_id_type in ('NIT', 'CC', 'CE')),
  fiscal_id_number        text,
  fiscal_regime           text check (fiscal_regime in ('COMUN', 'SIMPLE', 'NO_RESPONSABLE')),
  fiscal_responsibilities text[] not null default '{}',
  fiscal_address          text,
  municipality_code       text,
  department_code         text,

  -- Comportamiento del módulo
  inventory_decrement_on  text not null default 'INVOICE_ISSUE'
                            check (inventory_decrement_on in ('INVOICE_ISSUE', 'MANUAL')),
  default_doc_kind        text not null default 'POS'
                            check (default_doc_kind in ('POS', 'FACTURA_VENTA')),
  block_on_insufficient_stock boolean not null default false,

  -- Regla 5 UVT (art. 616-1 ET): el valor UVT cambia cada año.
  uvt_year                integer not null default 2026,
  uvt_value_cents         bigint not null default 5237400,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists billing_settings_clinic_uniq
  on public.billing_settings (clinic_id);

drop trigger if exists billing_settings_touch_updated_at on public.billing_settings;
create trigger billing_settings_touch_updated_at
  before update on public.billing_settings
  for each row execute function public.touch_updated_at();

alter table public.billing_settings enable row level security;

drop policy if exists "billing_settings_select" on public.billing_settings;
create policy "billing_settings_select"
  on public.billing_settings for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "billing_settings_insert" on public.billing_settings;
create policy "billing_settings_insert"
  on public.billing_settings for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "billing_settings_update" on public.billing_settings;
create policy "billing_settings_update"
  on public.billing_settings for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "billing_settings_delete" on public.billing_settings;
create policy "billing_settings_delete"
  on public.billing_settings for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── numbering_ranges (resoluciones de numeración DIAN) ──────────────────────
-- Un rango autorizado por tipo de documento: prefijo + consecutivos + vigencia.
-- current_number = último número ASIGNADO (arranca en range_from - 1).
-- En sandbox se auto-crea un rango ficticio; en 1f se cargan los reales.
create table if not exists public.numbering_ranges (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  created_by        uuid references public.profiles(id) on delete set null,

  doc_kind          text not null
                      check (doc_kind in ('FACTURA_VENTA', 'POS', 'NOTA_CREDITO', 'NOTA_DEBITO')),
  prefix            text not null default '',
  range_from        bigint not null,
  range_to          bigint not null,
  current_number    bigint not null,
  is_active         boolean not null default true,

  -- Datos de la resolución DIAN (null en rangos sandbox)
  resolution_number text,
  resolution_date   date,
  valid_from        date,
  valid_until       date,
  technical_key     text,
  provider_ref      text,
  is_sandbox        boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint numbering_ranges_bounds check (range_from > 0 and range_to >= range_from),
  constraint numbering_ranges_cursor check (current_number >= range_from - 1 and current_number <= range_to)
);

-- Un solo rango activo por clínica y tipo de documento.
create unique index if not exists numbering_ranges_active_uniq
  on public.numbering_ranges (clinic_id, doc_kind)
  where is_active;

drop trigger if exists numbering_ranges_touch_updated_at on public.numbering_ranges;
create trigger numbering_ranges_touch_updated_at
  before update on public.numbering_ranges
  for each row execute function public.touch_updated_at();

alter table public.numbering_ranges enable row level security;

drop policy if exists "numbering_ranges_select" on public.numbering_ranges;
create policy "numbering_ranges_select"
  on public.numbering_ranges for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "numbering_ranges_insert" on public.numbering_ranges;
create policy "numbering_ranges_insert"
  on public.numbering_ranges for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "numbering_ranges_update" on public.numbering_ranges;
create policy "numbering_ranges_update"
  on public.numbering_ranges for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "numbering_ranges_delete" on public.numbering_ranges;
create policy "numbering_ranges_delete"
  on public.numbering_ranges for delete
  using (clinic_id = (select private.my_clinic_id()));

-- Asignación ATÓMICA del siguiente consecutivo. El UPDATE toma row-lock, así
-- que dos emisiones concurrentes no pueden recibir el mismo número; si el rango
-- está agotado o inactivo, falla. SECURITY INVOKER: respeta RLS del caller.
create or replace function public.facturacion_assign_next_number(p_range_id uuid)
returns bigint
language plpgsql
as $$
declare
  v_number bigint;
begin
  update public.numbering_ranges
     set current_number = current_number + 1
   where id = p_range_id
     and is_active
     and current_number < range_to
     and (valid_until is null or valid_until >= current_date)
  returning current_number into v_number;

  if v_number is null then
    raise exception 'Rango de numeración agotado, vencido, inactivo o inexistente (%)', p_range_id;
  end if;

  return v_number;
end;
$$;

-- Se llama por RPC desde el front: el 0022 revocó el EXECUTE por defecto en
-- funciones nuevas, así que el grant debe ser explícito.
revoke execute on function public.facturacion_assign_next_number(uuid) from public, anon;
grant execute on function public.facturacion_assign_next_number(uuid) to authenticated, service_role;


-- ─── billing_payers (responsable del pago / adquiriente) ─────────────────────
-- Separado del titular clínico (owners): el que paga puede ser una empresa o
-- un tercero. Al facturar a un owner se crea/reusa un payer prellenado.
-- Datos mínimos DIAN (Comunicado 026-2025): nombre + tipo y nº de documento
-- (+ email solo si quiere entrega electrónica). Dirección/teléfono son opcionales.
create table if not exists public.billing_payers (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  created_by        uuid references public.profiles(id) on delete set null,

  kind              text not null default 'PERSONA' check (kind in ('PERSONA', 'EMPRESA')),
  doc_type          text not null
                      check (doc_type in ('CC', 'CE', 'NIT', 'PP', 'TI', 'PEP', 'NUIP')),
  doc_number        text not null,
  name              text not null,
  email             text,
  phone             text,
  address           text,
  municipality_code text,
  owner_id          uuid references public.owners(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists billing_payers_clinic_doc_idx
  on public.billing_payers (clinic_id, doc_type, doc_number);

create index if not exists billing_payers_owner_idx
  on public.billing_payers (owner_id)
  where owner_id is not null;

drop trigger if exists billing_payers_touch_updated_at on public.billing_payers;
create trigger billing_payers_touch_updated_at
  before update on public.billing_payers
  for each row execute function public.touch_updated_at();

alter table public.billing_payers enable row level security;

drop policy if exists "billing_payers_select" on public.billing_payers;
create policy "billing_payers_select"
  on public.billing_payers for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "billing_payers_insert" on public.billing_payers;
create policy "billing_payers_insert"
  on public.billing_payers for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "billing_payers_update" on public.billing_payers;
create policy "billing_payers_update"
  on public.billing_payers for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "billing_payers_delete" on public.billing_payers;
create policy "billing_payers_delete"
  on public.billing_payers for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── owners: tipo de documento (aditivo) ─────────────────────────────────────
-- Para prellenar el payer desde el titular sin romper nada existente.
alter table public.owners add column if not exists id_doc_type text;

alter table public.owners drop constraint if exists owners_id_doc_type_check;
alter table public.owners add constraint owners_id_doc_type_check
  check (id_doc_type is null or id_doc_type in ('CC', 'CE', 'NIT', 'PP', 'TI', 'PEP', 'NUIP'));


-- ─── catalog_items (servicios, productos, medicamentos, insumos) ─────────────
-- Unidades veterinarias: se compra en purchase_unit (frasco) y se usa/vende en
-- use_unit (ml); conversion_factor = use_units por 1 purchase_unit.
-- tax_status EXCLUIDO ≠ EXENTO (excluido no genera IVA; exento es tarifa 0%).
create table if not exists public.catalog_items (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  created_by        uuid references public.profiles(id) on delete set null,

  item_type         text not null
                      check (item_type in ('SERVICIO', 'PRODUCTO', 'MEDICAMENTO', 'INSUMO')),
  name              text not null,
  sku               text,
  description       text,

  purchase_unit     text not null default 'unidad',
  use_unit          text not null default 'unidad',
  conversion_factor numeric(12,4) not null default 1 check (conversion_factor > 0),

  price_cents       bigint not null check (price_cents >= 0),
  cost_cents        bigint check (cost_cents >= 0),
  tax_rate          smallint not null default 19 check (tax_rate in (0, 5, 19)),
  tax_status        text not null default 'GRAVADO'
                      check (tax_status in ('GRAVADO', 'EXENTO', 'EXCLUIDO')),

  track_stock       boolean not null default false,
  min_stock         numeric(12,4),
  supplier          text,
  location          text,
  active            boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Un ítem excluido o exento no lleva tarifa positiva.
  constraint catalog_items_tax_coherence
    check (tax_status = 'GRAVADO' or tax_rate = 0)
);

create index if not exists catalog_items_clinic_active_idx
  on public.catalog_items (clinic_id, active);

create index if not exists catalog_items_clinic_name_idx
  on public.catalog_items (clinic_id, name);

drop trigger if exists catalog_items_touch_updated_at on public.catalog_items;
create trigger catalog_items_touch_updated_at
  before update on public.catalog_items
  for each row execute function public.touch_updated_at();

alter table public.catalog_items enable row level security;

drop policy if exists "catalog_items_select" on public.catalog_items;
create policy "catalog_items_select"
  on public.catalog_items for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "catalog_items_insert" on public.catalog_items;
create policy "catalog_items_insert"
  on public.catalog_items for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "catalog_items_update" on public.catalog_items;
create policy "catalog_items_update"
  on public.catalog_items for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "catalog_items_delete" on public.catalog_items;
create policy "catalog_items_delete"
  on public.catalog_items for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── catalog_lots (lotes con vencimiento) ────────────────────────────────────
-- Sin clinic_id directo: RLS vía el ítem padre.
create table if not exists public.catalog_lots (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.catalog_items(id) on delete cascade,
  lot_code    text not null,
  expires_on  date,
  created_at  timestamptz not null default now()
);

create index if not exists catalog_lots_item_idx
  on public.catalog_lots (item_id);

alter table public.catalog_lots enable row level security;

drop policy if exists "catalog_lots_select" on public.catalog_lots;
create policy "catalog_lots_select"
  on public.catalog_lots for select
  using (
    exists (
      select 1 from public.catalog_items ci
      where ci.id = catalog_lots.item_id
        and ci.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "catalog_lots_insert" on public.catalog_lots;
create policy "catalog_lots_insert"
  on public.catalog_lots for insert
  with check (
    exists (
      select 1 from public.catalog_items ci
      where ci.id = catalog_lots.item_id
        and ci.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "catalog_lots_update" on public.catalog_lots;
create policy "catalog_lots_update"
  on public.catalog_lots for update
  using (
    exists (
      select 1 from public.catalog_items ci
      where ci.id = catalog_lots.item_id
        and ci.clinic_id = (select private.my_clinic_id())
    )
  )
  with check (
    exists (
      select 1 from public.catalog_items ci
      where ci.id = catalog_lots.item_id
        and ci.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "catalog_lots_delete" on public.catalog_lots;
create policy "catalog_lots_delete"
  on public.catalog_lots for delete
  using (
    exists (
      select 1 from public.catalog_items ci
      where ci.id = catalog_lots.item_id
        and ci.clinic_id = (select private.my_clinic_id())
    )
  );


-- ─── inventory_movements (existencia = Σ movimientos, nunca columna) ─────────
-- qty en use_unit, firmado: positivo entra, negativo sale. AJUSTE lleva
-- cualquier signo. La validación de signos vive en el dominio
-- (src/lib/facturacion/domain/inventory.ts).
create table if not exists public.inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,

  item_id         uuid not null references public.catalog_items(id) on delete cascade,
  lot_id          uuid references public.catalog_lots(id) on delete set null,
  qty             numeric(14,4) not null check (qty <> 0),
  movement_type   text not null
                    check (movement_type in
                      ('CARGA_INICIAL', 'ENTRADA_COMPRA', 'SALIDA_VENTA', 'SALIDA_APLICACION',
                       'CONSUMO_INTERNO', 'DEVOLUCION', 'VENCIMIENTO', 'PERDIDA', 'AJUSTE')),
  ref_type        text check (ref_type in ('INVOICE', 'IMPORT_BATCH', 'MANUAL')),
  ref_id          uuid,
  note            text,

  created_at      timestamptz not null default now()
);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (item_id);

create index if not exists inventory_movements_clinic_created_idx
  on public.inventory_movements (clinic_id, created_at desc);

alter table public.inventory_movements enable row level security;

drop policy if exists "inventory_movements_select" on public.inventory_movements;
create policy "inventory_movements_select"
  on public.inventory_movements for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "inventory_movements_insert" on public.inventory_movements;
create policy "inventory_movements_insert"
  on public.inventory_movements for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "inventory_movements_update" on public.inventory_movements;
create policy "inventory_movements_update"
  on public.inventory_movements for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "inventory_movements_delete" on public.inventory_movements;
create policy "inventory_movements_delete"
  on public.inventory_movements for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── invoices (factura / documento equivalente POS) ──────────────────────────
-- status es el ciclo de vida operativo; fiscal/collection/delivery_status son
-- CACHÉS derivados de invoice_events con deriveStatus. number es null en
-- borrador y se asigna al emitir (facturacion_assign_next_number).
-- El origen ligaba la factura a su tabla visits; aquí se liga a consultations.
create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics(id) on delete cascade,
  created_by          uuid references public.profiles(id) on delete set null,

  doc_kind            text not null default 'POS'
                        check (doc_kind in ('FACTURA_VENTA', 'POS')),
  status              text not null default 'BORRADOR'
                        check (status in ('BORRADOR', 'EMITIENDO', 'EMITIDA', 'ANULADA')),

  numbering_range_id  uuid references public.numbering_ranges(id) on delete restrict,
  number              bigint,
  full_number         text,

  payer_id            uuid references public.billing_payers(id) on delete restrict,
  patient_id          uuid references public.patients(id) on delete set null,
  consultation_id     uuid references public.consultations(id) on delete set null,

  payment_terms       text not null default 'IMMEDIATE'
                        check (payment_terms in ('IMMEDIATE', 'CREDIT')),
  due_date            date,

  subtotal_cents      bigint not null default 0,
  discount_cents      bigint not null default 0,
  tax_cents           bigint not null default 0,
  total_cents         bigint not null default 0,
  paid_cents          bigint not null default 0,
  credited_cents      bigint not null default 0,
  balance_cents       bigint not null default 0,

  fiscal_status       text not null default 'BORRADOR'
                        check (fiscal_status in
                          ('BORRADOR', 'PENDIENTE_VALIDACION', 'RECHAZADA', 'VALIDADA',
                           'AFECTADA_POR_NOTA_CREDITO')),
  collection_status   text not null default 'PENDIENTE'
                        check (collection_status in
                          ('PENDIENTE', 'PARCIALMENTE_PAGADA', 'PAGADA', 'VENCIDA',
                           'EN_DISPUTA', 'CASTIGADA')),
  delivery_status     text not null default 'NO_ENVIADA'
                        check (delivery_status in ('NO_ENVIADA', 'ENVIADA', 'ENTREGADA', 'FALLIDA')),
  reminders_paused    boolean not null default false,

  notes               text,
  share_token         uuid not null default gen_random_uuid(),
  issued_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- El consecutivo jamás se repite dentro del rango del emisor.
create unique index if not exists invoices_range_number_uniq
  on public.invoices (clinic_id, numbering_range_id, number)
  where number is not null;

create unique index if not exists invoices_share_token_uniq
  on public.invoices (share_token);

create index if not exists invoices_clinic_status_idx
  on public.invoices (clinic_id, status);

create index if not exists invoices_clinic_issued_idx
  on public.invoices (clinic_id, issued_at desc)
  where issued_at is not null;

create index if not exists invoices_payer_idx
  on public.invoices (payer_id)
  where payer_id is not null;

create index if not exists invoices_patient_idx
  on public.invoices (patient_id)
  where patient_id is not null;

create index if not exists invoices_consultation_idx
  on public.invoices (consultation_id)
  where consultation_id is not null;

drop trigger if exists invoices_touch_updated_at on public.invoices;
create trigger invoices_touch_updated_at
  before update on public.invoices
  for each row execute function public.touch_updated_at();

alter table public.invoices enable row level security;

drop policy if exists "invoices_select" on public.invoices;
create policy "invoices_select"
  on public.invoices for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "invoices_insert" on public.invoices;
create policy "invoices_insert"
  on public.invoices for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "invoices_update" on public.invoices;
create policy "invoices_update"
  on public.invoices for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "invoices_delete" on public.invoices;
create policy "invoices_delete"
  on public.invoices for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── invoice_lines (snapshot congelado al emitir) ────────────────────────────
-- Fotografía histórica: cambios futuros de precio/nombre del catálogo no la
-- alteran. RLS vía la factura padre.
create table if not exists public.invoice_lines (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  catalog_item_id   uuid references public.catalog_items(id) on delete set null,

  description       text not null,
  qty               numeric(14,4) not null check (qty > 0),
  unit              text not null default 'unidad',
  unit_price_cents  bigint not null check (unit_price_cents >= 0),
  tax_rate          smallint not null check (tax_rate in (0, 5, 19)),
  tax_status        text not null default 'GRAVADO'
                      check (tax_status in ('GRAVADO', 'EXENTO', 'EXCLUIDO')),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),

  subtotal_cents    bigint not null,
  tax_cents         bigint not null,
  total_cents       bigint not null,

  position          integer not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists invoice_lines_invoice_idx
  on public.invoice_lines (invoice_id);

alter table public.invoice_lines enable row level security;

drop policy if exists "invoice_lines_select" on public.invoice_lines;
create policy "invoice_lines_select"
  on public.invoice_lines for select
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "invoice_lines_insert" on public.invoice_lines;
create policy "invoice_lines_insert"
  on public.invoice_lines for insert
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "invoice_lines_update" on public.invoice_lines;
create policy "invoice_lines_update"
  on public.invoice_lines for update
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "invoice_lines_delete" on public.invoice_lines;
create policy "invoice_lines_delete"
  on public.invoice_lines for delete
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  );


-- ─── invoice_events (fuente de verdad de estados; append-only) ───────────────
create table if not exists public.invoice_events (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  event_type  text not null
                check (event_type in
                  ('CREATED', 'ISSUED', 'FISCAL_SUBMITTED', 'FISCAL_VALIDATED', 'FISCAL_REJECTED',
                   'SENT', 'DELIVERED', 'DELIVERY_FAILED', 'PAYMENT_APPLIED', 'DISPUTE_OPENED',
                   'DISPUTE_CLOSED', 'CREDIT_NOTE_APPLIED', 'WRITTEN_OFF', 'REMINDERS_PAUSED',
                   'REMINDERS_RESUMED', 'PROMISE_TO_PAY')),
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists invoice_events_invoice_created_idx
  on public.invoice_events (invoice_id, created_at);

alter table public.invoice_events enable row level security;

drop policy if exists "invoice_events_select" on public.invoice_events;
create policy "invoice_events_select"
  on public.invoice_events for select
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_events.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "invoice_events_insert" on public.invoice_events;
create policy "invoice_events_insert"
  on public.invoice_events for insert
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_events.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  );

-- Append-only: sin policies de update/delete (nadie salvo service-role).


-- ─── fiscal_documents (transmisiones al proveedor DIAN) ──────────────────────
-- Guarda request/response completos + CUFE + rutas de XML/PDF en storage
-- (bucket privado fiscal-docs, fase 1f). Conservación ≥ 5 años: NUNCA se
-- borra en cascada desde invoices (solo si se borra la clínica completa).
create table if not exists public.fiscal_documents (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  created_by        uuid references public.profiles(id) on delete set null,

  invoice_id        uuid references public.invoices(id) on delete restrict,
  -- FK a credit_notes se añade al final (la tabla se crea más abajo)
  credit_note_id    uuid,
  provider          text not null,
  doc_kind          text not null
                      check (doc_kind in ('FACTURA_VENTA', 'POS', 'NOTA_CREDITO', 'NOTA_DEBITO')),
  status            text not null default 'PENDIENTE'
                      check (status in ('PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'CONTINGENCIA')),
  cufe              text,
  request_payload   jsonb,
  response_payload  jsonb,
  xml_storage_path  text,
  pdf_storage_path  text,
  attempts          integer not null default 0,
  last_error        text,
  submitted_at      timestamptz,
  accepted_at       timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists fiscal_documents_invoice_idx
  on public.fiscal_documents (invoice_id)
  where invoice_id is not null;

create index if not exists fiscal_documents_clinic_status_idx
  on public.fiscal_documents (clinic_id, status);

drop trigger if exists fiscal_documents_touch_updated_at on public.fiscal_documents;
create trigger fiscal_documents_touch_updated_at
  before update on public.fiscal_documents
  for each row execute function public.touch_updated_at();

alter table public.fiscal_documents enable row level security;

drop policy if exists "fiscal_documents_select" on public.fiscal_documents;
create policy "fiscal_documents_select"
  on public.fiscal_documents for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "fiscal_documents_insert" on public.fiscal_documents;
create policy "fiscal_documents_insert"
  on public.fiscal_documents for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "fiscal_documents_update" on public.fiscal_documents;
create policy "fiscal_documents_update"
  on public.fiscal_documents for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

-- Sin delete: los documentos fiscales se conservan (art. 632 ET).


-- ─── credit_notes (única forma de afectar una factura emitida) ───────────────
-- "Falta de pago" NO es causal válida (Concepto DIAN 106/2022): la regla se
-- valida en dominio (isValidCreditNoteReason) antes de insertar.
create table if not exists public.credit_notes (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics(id) on delete cascade,
  created_by          uuid references public.profiles(id) on delete set null,

  invoice_id          uuid not null references public.invoices(id) on delete restrict,
  numbering_range_id  uuid references public.numbering_ranges(id) on delete restrict,
  number              bigint,
  full_number         text,
  status              text not null default 'BORRADOR'
                        check (status in ('BORRADOR', 'EMITIDA')),
  reason_code         text not null
                        check (reason_code in
                          ('DEVOLUCION', 'ANULACION', 'DESCUENTO', 'AJUSTE_PRECIO', 'OTROS')),
  reason_text         text not null,
  total_cents         bigint not null check (total_cents > 0),

  issued_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists credit_notes_range_number_uniq
  on public.credit_notes (clinic_id, numbering_range_id, number)
  where number is not null;

create index if not exists credit_notes_invoice_idx
  on public.credit_notes (invoice_id);

drop trigger if exists credit_notes_touch_updated_at on public.credit_notes;
create trigger credit_notes_touch_updated_at
  before update on public.credit_notes
  for each row execute function public.touch_updated_at();

alter table public.credit_notes enable row level security;

drop policy if exists "credit_notes_select" on public.credit_notes;
create policy "credit_notes_select"
  on public.credit_notes for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "credit_notes_insert" on public.credit_notes;
create policy "credit_notes_insert"
  on public.credit_notes for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "credit_notes_update" on public.credit_notes;
create policy "credit_notes_update"
  on public.credit_notes for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

-- Sin delete: una nota crédito emitida se conserva.


-- ─── payments + payment_applications (pagos manuales en v1) ──────────────────
-- gateway/gateway_event_id quedan listos para la pasarela (Fase 2): el UNIQUE
-- parcial garantiza idempotencia del webhook cuando llegue.
create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  created_by        uuid references public.profiles(id) on delete set null,

  method            text not null
                      check (method in ('EFECTIVO', 'TRANSFERENCIA', 'ENLACE', 'TARJETA')),
  amount_cents      bigint not null check (amount_cents > 0),
  reference         text,
  gateway           text,
  gateway_event_id  text,
  received_at       timestamptz not null default now(),
  note              text,

  created_at        timestamptz not null default now()
);

create unique index if not exists payments_gateway_event_uniq
  on public.payments (gateway, gateway_event_id)
  where gateway_event_id is not null;

create index if not exists payments_clinic_received_idx
  on public.payments (clinic_id, received_at desc);

alter table public.payments enable row level security;

drop policy if exists "payments_select" on public.payments;
create policy "payments_select"
  on public.payments for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "payments_insert" on public.payments;
create policy "payments_insert"
  on public.payments for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "payments_update" on public.payments;
create policy "payments_update"
  on public.payments for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "payments_delete" on public.payments;
create policy "payments_delete"
  on public.payments for delete
  using (clinic_id = (select private.my_clinic_id()));


create table if not exists public.payment_applications (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references public.payments(id) on delete cascade,
  invoice_id    uuid not null references public.invoices(id) on delete restrict,
  amount_cents  bigint not null check (amount_cents > 0),
  created_at    timestamptz not null default now()
);

create index if not exists payment_applications_payment_idx
  on public.payment_applications (payment_id);

create index if not exists payment_applications_invoice_idx
  on public.payment_applications (invoice_id);

alter table public.payment_applications enable row level security;

drop policy if exists "payment_applications_select" on public.payment_applications;
create policy "payment_applications_select"
  on public.payment_applications for select
  using (
    exists (
      select 1 from public.payments p
      where p.id = payment_applications.payment_id
        and p.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "payment_applications_insert" on public.payment_applications;
create policy "payment_applications_insert"
  on public.payment_applications for insert
  with check (
    exists (
      select 1 from public.payments p
      where p.id = payment_applications.payment_id
        and p.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "payment_applications_delete" on public.payment_applications;
create policy "payment_applications_delete"
  on public.payment_applications for delete
  using (
    exists (
      select 1 from public.payments p
      where p.id = payment_applications.payment_id
        and p.clinic_id = (select private.my_clinic_id())
    )
  );


-- ─── FK diferida: fiscal_documents → credit_notes ────────────────────────────
alter table public.fiscal_documents drop constraint if exists fiscal_documents_credit_note_fk;
alter table public.fiscal_documents add constraint fiscal_documents_credit_note_fk
  foreign key (credit_note_id) references public.credit_notes(id) on delete restrict;

-- 0043 — Endurecimiento DB del módulo de facturación (auditoría 2026-07-30).
--
-- (Nació como 0042 y se renumeró: `0042_appointments_google_event_unique.sql` entró a master en
-- paralelo el 2026-07-31. Dos migraciones con el mismo número aplican en orden indefinido.)
--
-- Dos cosas, ambas señaladas por los advisors de Supabase sobre el proyecto principal:
--
-- 1) `search_path` fijo en las funciones de facturación. `facturacion_assign_next_number` y
--    `touch_updated_at` tenían search_path mutable (lint 0011): una función SECURITY DEFINER o
--    llamada por trigger con search_path del entorno puede resolver objetos de un schema ajeno.
--    Se fija a `public` sin tocar el cuerpo.
--
-- 2) Índices para las FKs sin cubrir de facturación/equipo (lint unindexed_foreign_keys, 21
--    entradas). Sin índice, cada DELETE/UPDATE del padre escanea la tabla hija completa, y los
--    JOIN por esas columnas también. Todos con IF NOT EXISTS: re-aplicar es inocuo.
--
-- NO se aplica automáticamente: flujo dev → PR → principal con los mismos archivos (MIGRACIONES.md).

alter function public.facturacion_assign_next_number(uuid) set search_path = public;
alter function public.touch_updated_at() set search_path = public;

-- Facturación: emisor y catálogo
create index if not exists idx_billing_payers_created_by on public.billing_payers (created_by);
create index if not exists idx_catalog_categories_created_by on public.catalog_categories (created_by);
create index if not exists idx_catalog_categories_parent_id on public.catalog_categories (parent_id);
create index if not exists idx_catalog_items_category_id on public.catalog_items (category_id);
create index if not exists idx_catalog_items_created_by on public.catalog_items (created_by);
create index if not exists idx_catalog_items_supplier_id on public.catalog_items (supplier_id);

-- Facturas y pagos
create index if not exists idx_invoices_created_by on public.invoices (created_by);
create index if not exists idx_invoices_numbering_range_id on public.invoices (numbering_range_id);
create index if not exists idx_invoice_lines_catalog_item_id on public.invoice_lines (catalog_item_id);
create index if not exists idx_invoice_email_threads_invoice_id on public.invoice_email_threads (invoice_id);
create index if not exists idx_invoice_reminders_sent_comm_id on public.invoice_reminders (sent_comm_id);
create index if not exists idx_payments_created_by on public.payments (created_by);

-- Compras, gastos e inventario
create index if not exists idx_expenses_created_by on public.expenses (created_by);
create index if not exists idx_expenses_supplier_id on public.expenses (supplier_id);
create index if not exists idx_inventory_movements_created_by on public.inventory_movements (created_by);
create index if not exists idx_inventory_movements_lot_id on public.inventory_movements (lot_id);
create index if not exists idx_purchases_created_by on public.purchases (created_by);
create index if not exists idx_purchases_supplier_id on public.purchases (supplier_id);
create index if not exists idx_purchase_items_catalog_item_id on public.purchase_items (catalog_item_id);
create index if not exists idx_suppliers_created_by on public.suppliers (created_by);

-- Equipo
create index if not exists idx_invitations_invited_by on public.invitations (invited_by);

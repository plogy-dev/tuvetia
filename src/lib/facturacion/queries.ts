// Lecturas del módulo de facturación. Todas reciben el supabase client
// AUTENTICADO de la sesión (RLS activo) + clinicId explícito: aunque un caller
// pase un id ajeno, Postgres devuelve vacío por RLS. Cuando el caller es el
// cron (service_role), el clinicId explícito es el ÚNICO aislamiento — por eso
// es obligatorio en cada query (regla dura del contrato).

import type { SupabaseClient } from '@supabase/supabase-js';
import { bogotaTodayISO, finDelDiaBogota } from '@/lib/date-utils';
import {
  EMBED_DE_FACTURAS,
  TOPE_SIN_FACTURAR,
  desdeCuando,
  soloSinFacturar,
} from '@/lib/facturacion/sin-facturar';
import type {
  BillingPayerRow,
  BillingSettingsRow,
  CatalogCategoryRow,
  CatalogItemRow,
  CatalogLotRow,
  FiscalDocumentRow,
  InvoiceEventRow,
  InvoiceLineRow,
  InvoiceRow,
  InventoryMovementRow,
  ExpenseRow,
  NumberingRangeRow,
  OwnerRow,
  PaymentRow,
  PurchaseItemRow,
  PurchaseRow,
  SupplierRow,
} from '@/lib/supabase/types';
import { lotNearExpiry } from '@/lib/facturacion/domain/inventory';
import { DEFAULT_VET_CATEGORIES } from '@/lib/facturacion/domain/categories';
import { CONSUMIDOR_FINAL } from './constants';

// ─── Configuración del emisor ────────────────────────────────────────────────

export async function getBillingSettings(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<BillingSettingsRow | null> {
  const { data, error } = await supabase
    .from('billing_settings')
    .select('*')
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer billing_settings: ${error.message}`);
  return (data as BillingSettingsRow | null) ?? null;
}

// ─── Catálogo ────────────────────────────────────────────────────────────────

export async function listCatalogItems(
  supabase: SupabaseClient,
  clinicId: string,
  opts: {
    query?: string;
    itemType?: string;
    includeInactive?: boolean;
    categoryId?: string;
  } = {},
): Promise<CatalogItemRow[]> {
  // PAGINA, no corta. Antes era un `.limit(500)` pelado, y el truncamiento no se veía por ningún
  // lado: ni error, ni aviso, ni un "500 de 812" en pantalla.
  //
  // DÓNDE MUERDE PEOR: el export de inventario a Excel (`api/facturacion/inventario/export`) llama
  // acá con `includeInactive`. Un catálogo de 800 ítems salía como un archivo de 500 que parece
  // completo — y ese archivo se usa para inventariar y para contabilidad. Además lo usan el
  // selector de la factura nueva, compras, movimientos y la pantalla de inventario: en todas, los
  // ítems que faltan simplemente no existen.
  //
  // Y APARECE JUSTO DESPUÉS DE IMPORTAR. Una clínica que sube su catálogo por Excel es la que más
  // ítems tiene y la que va a contarlos: importa 800, ve 500, y concluye que la importación perdió
  // 300.
  //
  // Es el mismo truncamiento silencioso de `getDashboardKpis` y `getStockMap` —el `max-rows` de
  // PostgREST es 1000 y pedir más devuelve mil SIN error— con la misma receta. Ésta es la tercera.
  //
  // El `.order('id')` de desempate es lo que hace estable la paginación: `name` puede repetirse
  // (dos presentaciones del mismo producto) y sin un segundo criterio Postgres no garantiza que la
  // página 2 no repita filas de la 1.
  const PAGE = 1000;
  const todos: CatalogItemRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('catalog_items')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('name', { ascending: true })
      .order('id')
      .range(from, from + PAGE - 1);
    if (!opts.includeInactive) q = q.eq('active', true);
    if (opts.itemType) q = q.eq('item_type', opts.itemType);
    if (opts.categoryId) q = q.eq('category_id', opts.categoryId);
    if (opts.query?.trim()) {
      const term = `%${opts.query.trim()}%`;
      q = q.or(`name.ilike.${term},sku.ilike.${term},barcode.ilike.${term}`);
    }
    const { data, error } = await q;
    if (error) throw new Error(`No se pudo listar el catálogo: ${error.message}`);
    const filas = (data as CatalogItemRow[]) ?? [];
    todos.push(...filas);
    if (filas.length < PAGE) break;
  }
  return todos;
}

export async function getCatalogItems(
  supabase: SupabaseClient,
  clinicId: string,
  itemIds: string[],
): Promise<Map<string, CatalogItemRow>> {
  if (itemIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('catalog_items')
    .select('*')
    .eq('clinic_id', clinicId)
    .in('id', itemIds);
  if (error) throw new Error(`No se pudieron leer ítems del catálogo: ${error.message}`);
  return new Map(((data as CatalogItemRow[]) ?? []).map((i) => [i.id, i]));
}

// ─── Existencias (stock = Σ movimientos; sin columna editable) ───────────────

/**
 * Mapa item_id → existencia actual (en use_unit). Suma en JS porque supabase-js no expone GROUP BY.
 *
 * PAGINA a paso de 1000, que es el max-rows de PostgREST. Sin eso, una clínica con más de mil
 * movimientos calculaba la existencia sobre mil filas ARBITRARIAS: el stock salía más bajo de lo
 * real y no determinista, y eso no es cosmético — alimenta el bloqueo `EXISTENCIA_INSUFICIENTE` de
 * la emisión (bloquea ventas legítimas), el aviso de "bajo mínimo" y el valor del inventario a
 * costo. Un movimiento por venta y por compra llega a mil antes de lo que parece.
 *
 * Es el mismo truncamiento silencioso que ya se corrigió en `getDashboardKpis`, con la misma receta.
 * El `.order('id')` es lo que hace que la paginación sea estable: sin un orden explícito, Postgres
 * no garantiza que la página 2 no repita filas de la 1.
 */
export async function getStockMap(
  supabase: SupabaseClient,
  clinicId: string,
  itemIds?: string[],
): Promise<Map<string, number>> {
  if (itemIds && itemIds.length === 0) return new Map();
  const PAGE = 1000;
  const map = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('inventory_movements')
      .select('item_id, qty')
      .eq('clinic_id', clinicId)
      .order('id')
      .range(from, from + PAGE - 1);
    if (itemIds) q = q.in('item_id', itemIds);
    const { data, error } = await q;
    if (error) throw new Error(`No se pudieron leer movimientos: ${error.message}`);
    const filas = (data as { item_id: string; qty: number }[]) ?? [];
    for (const m of filas) {
      map.set(m.item_id, (map.get(m.item_id) ?? 0) + Number(m.qty));
    }
    if (filas.length < PAGE) break;
  }
  for (const [k, v] of map) map.set(k, Math.round(v * 1e6) / 1e6);
  return map;
}

// ─── Categorías ──────────────────────────────────────────────────────────────

/** Categorías de la clínica, ordenadas; por defecto solo las vigentes. */
export async function listCategories(
  supabase: SupabaseClient,
  clinicId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<CatalogCategoryRow[]> {
  let q = supabase
    .from('catalog_categories')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (!opts.includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q;
  if (error) throw new Error(`No se pudieron leer las categorías: ${error.message}`);
  return (data as CatalogCategoryRow[]) ?? [];
}

/**
 * Garantiza que la clínica tenga la semilla de categorías veterinarias + la
 * default «Sin categoría». Idempotente: solo crea las que falten por nombre.
 * `createdBy` (perfil del usuario) queda como autoría cuando se conoce.
 */
export async function ensureDefaultCategories(
  supabase: SupabaseClient,
  clinicId: string,
  createdBy?: string | null,
): Promise<void> {
  const existing = await listCategories(supabase, clinicId, { includeArchived: true });
  const haveNames = new Set(existing.map((c) => c.name.trim().toLowerCase()));
  const hasDefault = existing.some((c) => c.is_default);

  const rows: Array<Record<string, unknown>> = [];
  if (!hasDefault && !haveNames.has('sin categoría')) {
    rows.push({
      clinic_id: clinicId,
      created_by: createdBy ?? null,
      name: 'Sin categoría',
      is_default: true,
      sort_order: 999,
    });
  }
  DEFAULT_VET_CATEGORIES.forEach((name, i) => {
    if (!haveNames.has(name.toLowerCase())) {
      rows.push({
        clinic_id: clinicId,
        created_by: createdBy ?? null,
        name,
        is_default: false,
        sort_order: i,
      });
    }
  });
  if (rows.length === 0) return;
  const { error } = await supabase.from('catalog_categories').insert(rows);
  // 23505 = carrera con el índice único parcial: otra pestaña ya sembró.
  if (error && error.code !== '23505') {
    throw new Error(`No se pudieron sembrar las categorías: ${error.message}`);
  }
}

/**
 * Get-or-create de categorías por nombre (case-insensitive) — para el import.
 * Devuelve un Map de lower(trim(nombre)) → id entre las categorías VIGENTES.
 * Idempotente y tolerante a carreras (23505 → relee y resuelve).
 */
export async function ensureCategoriesByName(
  supabase: SupabaseClient,
  clinicId: string,
  names: string[],
  createdBy?: string | null,
): Promise<Map<string, string>> {
  // key normalizada → nombre original con el que se crearía
  const wanted = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name) wanted.set(name.toLowerCase(), name);
  }
  const result = new Map<string, string>();
  if (wanted.size === 0) return result;

  const existing = await listCategories(supabase, clinicId);
  for (const c of existing) result.set(c.name.trim().toLowerCase(), c.id);

  const missing = [...wanted.entries()].filter(([key]) => !result.has(key));
  if (missing.length === 0) return result;

  // Las nuevas se insertan después de las no-default (la default «Sin
  // categoría» vive en sort_order 999 y debe quedar al final).
  const maxSort = existing
    .filter((c) => !c.is_default)
    .reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0);
  const { error } = await supabase.from('catalog_categories').insert(
    missing.map(([, name], i) => ({
      clinic_id: clinicId,
      created_by: createdBy ?? null,
      name,
      is_default: false,
      sort_order: maxSort + 1 + i,
    })),
  );
  // 23505 = carrera con el índice único parcial: otra pestaña la creó.
  if (error && error.code !== '23505') {
    throw new Error(`No se pudieron crear las categorías del import: ${error.message}`);
  }
  const after = await listCategories(supabase, clinicId);
  for (const c of after) result.set(c.name.trim().toLowerCase(), c.id);
  return result;
}

// ─── Finanzas: ingresos (payments) y egresos (expenses) ──────────────────────

/** Pagos recibidos en el rango [from, to] (fechas `YYYY-MM-DD`, inclusive). */
export async function listPaymentsInRange(
  supabase: SupabaseClient,
  clinicId: string,
  range: { from: string; to: string },
): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('clinic_id', clinicId)
    // Bogotá es UTC-5: el día local `to` termina a las 04:59:59Z del siguiente.
    .gte('received_at', `${range.from}T05:00:00Z`)
    .lt('received_at', `${nextDay(range.to)}T05:00:00Z`)
    .order('received_at', { ascending: false });
  if (error) throw new Error(`No se pudieron leer los pagos: ${error.message}`);
  return (data as PaymentRow[]) ?? [];
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Egresos del rango, opcionalmente filtrados por categoría. */
export async function listExpenses(
  supabase: SupabaseClient,
  clinicId: string,
  opts: { from: string; to: string; category?: string },
): Promise<ExpenseRow[]> {
  let q = supabase
    .from('expenses')
    .select('*')
    .eq('clinic_id', clinicId)
    .gte('expense_date', opts.from)
    .lte('expense_date', opts.to)
    .order('expense_date', { ascending: false });
  if (opts.category) q = q.eq('category', opts.category);
  const { data, error } = await q;
  if (error) throw new Error(`No se pudieron leer los egresos: ${error.message}`);
  return (data as ExpenseRow[]) ?? [];
}

/** Payer de un titular del CRM, si existe (solo lectura, no crea). */
export async function getPayerForOwner(
  supabase: SupabaseClient,
  clinicId: string,
  ownerId: string,
): Promise<BillingPayerRow | null> {
  const { data, error } = await supabase
    .from('billing_payers')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo buscar el pagador: ${error.message}`);
  return (data as BillingPayerRow | null) ?? null;
}

export type AppliedPayment = {
  id: string;
  amount_cents: number;
  invoice_id: string;
  payment: Pick<PaymentRow, 'method' | 'received_at' | 'reference' | 'note'> | null;
  invoice: { full_number: string | null } | null;
};

/** Historial de pagos aplicados a un conjunto de facturas (ficha del paciente). */
export async function listPaymentsForInvoices(
  supabase: SupabaseClient,
  _clinicId: string,
  invoiceIds: string[],
): Promise<AppliedPayment[]> {
  if (invoiceIds.length === 0) return [];
  const { data, error } = await supabase
    .from('payment_applications')
    .select(
      'id, amount_cents, invoice_id, payment:payments(method, received_at, reference, note), invoice:invoices(full_number)',
    )
    .in('invoice_id', invoiceIds);
  if (error) throw new Error(`No se pudieron leer los pagos: ${error.message}`);
  const rows = (data as unknown as AppliedPayment[]) ?? [];
  return rows.sort((a, b) =>
    (b.payment?.received_at ?? '').localeCompare(a.payment?.received_at ?? ''),
  );
}

/**
 * Mapa payment_id → invoice_id de los pagos aplicados a facturas. Sirve para
 * marcar los no-editables sueltos Y para linkear el ingreso a su factura.
 */
export async function getAppliedPaymentMap(
  supabase: SupabaseClient,
  paymentIds: string[],
): Promise<Map<string, string>> {
  if (paymentIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('payment_applications')
    .select('payment_id, invoice_id')
    .in('payment_id', paymentIds);
  if (error) throw new Error(`No se pudieron leer las aplicaciones: ${error.message}`);
  return new Map(
    ((data as { payment_id: string; invoice_id: string }[]) ?? []).map((r) => [
      r.payment_id,
      r.invoice_id,
    ]),
  );
}

// ─── Compras ─────────────────────────────────────────────────────────────────

export type PurchaseWithSupplier = PurchaseRow & { supplier: { name: string } | null };

/** Compras de la clínica, recientes primero, con el nombre del proveedor. */
export async function listPurchases(
  supabase: SupabaseClient,
  clinicId: string,
  opts: { limit?: number } = {},
): Promise<PurchaseWithSupplier[]> {
  const { data, error } = await supabase
    .from('purchases')
    .select('*, supplier:suppliers(name)')
    .eq('clinic_id', clinicId)
    .order('purchased_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100);
  if (error) throw new Error(`No se pudieron leer las compras: ${error.message}`);
  return (data as PurchaseWithSupplier[]) ?? [];
}

export type PurchaseItemWithCatalog = PurchaseItemRow & {
  item: { name: string; purchase_unit: string; use_unit: string; conversion_factor: number } | null;
};

/** Una compra con sus líneas (y la info de catálogo para mostrarlas). */
export async function getPurchaseDetail(
  supabase: SupabaseClient,
  clinicId: string,
  purchaseId: string,
): Promise<{ purchase: PurchaseWithSupplier; items: PurchaseItemWithCatalog[] } | null> {
  const { data: purchase, error } = await supabase
    .from('purchases')
    .select('*, supplier:suppliers(name)')
    .eq('clinic_id', clinicId)
    .eq('id', purchaseId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la compra: ${error.message}`);
  if (!purchase) return null;

  const { data: items, error: itemsErr } = await supabase
    .from('purchase_items')
    .select('*, item:catalog_items(name, purchase_unit, use_unit, conversion_factor)')
    .eq('clinic_id', clinicId)
    .eq('purchase_id', purchaseId)
    .order('created_at', { ascending: true });
  if (itemsErr) throw new Error(`No se pudieron leer las líneas: ${itemsErr.message}`);

  return {
    purchase: purchase as PurchaseWithSupplier,
    items: (items as PurchaseItemWithCatalog[]) ?? [],
  };
}

// ─── Proveedores ─────────────────────────────────────────────────────────────

/**
 * Get-or-create de proveedores por nombre (case-insensitive) — para el import.
 * Devuelve Map de lower(trim(nombre)) → id entre los ACTIVOS. Tolerante a
 * carreras (23505 → relee), mismo patrón que ensureCategoriesByName.
 */
export async function ensureSuppliersByName(
  supabase: SupabaseClient,
  clinicId: string,
  names: string[],
  createdBy?: string | null,
): Promise<Map<string, string>> {
  const wanted = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name) wanted.set(name.toLowerCase(), name);
  }
  const result = new Map<string, string>();
  if (wanted.size === 0) return result;

  const existing = await listSuppliers(supabase, clinicId);
  for (const s of existing) result.set(s.name.trim().toLowerCase(), s.id);

  const missing = [...wanted.entries()].filter(([key]) => !result.has(key));
  if (missing.length === 0) return result;

  const { error } = await supabase
    .from('suppliers')
    .insert(
      missing.map(([, name]) => ({ clinic_id: clinicId, created_by: createdBy ?? null, name })),
    );
  if (error && error.code !== '23505') {
    throw new Error(`No se pudieron crear los proveedores del import: ${error.message}`);
  }
  const after = await listSuppliers(supabase, clinicId);
  for (const s of after) result.set(s.name.trim().toLowerCase(), s.id);
  return result;
}

/** Proveedores de la clínica, por defecto solo los activos, por nombre. */
export async function listSuppliers(
  supabase: SupabaseClient,
  clinicId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<SupplierRow[]> {
  let q = supabase
    .from('suppliers')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('name', { ascending: true });
  if (!opts.includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw new Error(`No se pudieron leer los proveedores: ${error.message}`);
  return (data as SupplierRow[]) ?? [];
}

// ─── Recetas de consumo ──────────────────────────────────────────────────────

export type RecipeComponent = {
  id: string;
  component_id: string;
  qty: number;
  note: string | null;
  component: { name: string; use_unit: string; track_stock: boolean } | null;
};

/** Receta (componentes) de un servicio, con la info del ítem componente. */
export async function getServiceRecipe(
  supabase: SupabaseClient,
  clinicId: string,
  serviceId: string,
): Promise<RecipeComponent[]> {
  const { data, error } = await supabase
    .from('service_consumptions')
    .select('id, component_id, qty, note, component:catalog_items!service_consumptions_component_id_fkey(name, use_unit, track_stock)')
    .eq('clinic_id', clinicId)
    .eq('service_id', serviceId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`No se pudo leer la receta: ${error.message}`);
  return (data as unknown as RecipeComponent[]) ?? [];
}

/** Map servicio → componentes (para el descuento al emitir). */
export async function getRecipesForServices(
  supabase: SupabaseClient,
  clinicId: string,
  serviceIds: string[],
): Promise<Map<string, { component_id: string; qty: number }[]>> {
  const map = new Map<string, { component_id: string; qty: number }[]>();
  if (serviceIds.length === 0) return map;
  const { data, error } = await supabase
    .from('service_consumptions')
    .select('service_id, component_id, qty')
    .eq('clinic_id', clinicId)
    .in('service_id', serviceIds);
  if (error) throw new Error(`No se pudieron leer las recetas: ${error.message}`);
  for (const r of (data as { service_id: string; component_id: string; qty: number }[]) ?? []) {
    const arr = map.get(r.service_id) ?? [];
    arr.push({ component_id: r.component_id, qty: Number(r.qty) });
    map.set(r.service_id, arr);
  }
  return map;
}

export type RecentMovement = InventoryMovementRow & { item: { name: string } | null };

export type MovementWithItem = InventoryMovementRow & {
  item: { name: string; use_unit: string } | null;
};

/**
 * Historial completo de movimientos con filtros (página Movimientos/Salidas).
 * dir: 'entrada' = qty > 0, 'salida' = qty < 0. Paginación simple por offset.
 */
export async function listMovements(
  supabase: SupabaseClient,
  clinicId: string,
  opts: {
    dir?: 'entrada' | 'salida';
    type?: string;
    itemId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{ movements: MovementWithItem[]; total: number }> {
  const pageSize = opts.pageSize ?? 100;
  const page = Math.max(1, opts.page ?? 1);
  let q = supabase
    .from('inventory_movements')
    .select('*, item:catalog_items(name, use_unit)', { count: 'exact' })
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (opts.dir === 'entrada') q = q.gt('qty', 0);
  if (opts.dir === 'salida') q = q.lt('qty', 0);
  if (opts.type) q = q.eq('movement_type', opts.type);
  if (opts.itemId) q = q.eq('item_id', opts.itemId);
  // Días locales Bogotá (UTC-5): [from 00:00, to 24:00) → ventana UTC +5h.
  if (opts.from) q = q.gte('created_at', `${opts.from}T05:00:00Z`);
  if (opts.to) q = q.lt('created_at', `${nextDay(opts.to)}T05:00:00Z`);
  const { data, error, count } = await q;
  if (error) throw new Error(`No se pudieron leer los movimientos: ${error.message}`);
  return { movements: (data as unknown as MovementWithItem[]) ?? [], total: count ?? 0 };
}

export async function getRecentMovements(
  supabase: SupabaseClient,
  clinicId: string,
  limit = 15,
): Promise<RecentMovement[]> {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('*, item:catalog_items(name)')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`No se pudieron leer los movimientos: ${error.message}`);
  return (data as unknown as RecentMovement[]) ?? [];
}

/** Ítems con algún lote que vence dentro de la ventana. */
export async function getNearExpirySet(
  supabase: SupabaseClient,
  clinicId: string,
  itemIds: string[],
  now: Date,
  windowDays = 30,
): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('catalog_lots')
    .select('item_id, expires_on, catalog_items!inner(clinic_id)')
    .eq('catalog_items.clinic_id', clinicId)
    .in('item_id', itemIds)
    .not('expires_on', 'is', null);
  if (error) throw new Error(`No se pudieron leer lotes: ${error.message}`);
  const set = new Set<string>();
  for (const lot of (data as unknown as Pick<CatalogLotRow, 'item_id' | 'expires_on'>[]) ?? []) {
    // `finDelDiaBogota` Y NO `new Date(…)`. `expires_on` es una columna DATE: PostgREST la entrega
    // como "2027-01-15", y la forma ISO sólo-fecha **se parsea siempre en UTC, por spec**. En
    // Bogotá eso es el 14 a las 19:00 — o sea que el lote se daba por vencido cinco horas antes de
    // que terminara su día.
    //
    // Es el MISMO defecto que ya se corrigió para `due_date` (ver `date-utils` y
    // `vencimiento-zona.test.ts`), y a `expires_on` no le había llegado. Un lote vale hasta el
    // final de su día: eso es lo que devuelve `finDelDiaBogota`.
    //
    // Sobre una ventana de 30 días las cinco horas casi nunca cambian la respuesta — pero cuando la
    // cambian, cambian en el borde, que es justo el día en que alguien mira la alerta.
    if (lot.expires_on && lotNearExpiry(finDelDiaBogota(lot.expires_on), now, windowDays)) {
      set.add(lot.item_id);
    }
  }
  return set;
}

// ─── Pagadores (adquirientes) ────────────────────────────────────────────────

/**
 * Devuelve (o crea) el payer asociado a un titular del CRM, prellenado con sus
 * datos. Si el titular no tiene documento, se usa la identificación genérica
 * de consumidor final (válida para POS; para factura de venta el vet deberá
 * completar el documento real — validateBuyerData lo exige).
 */
export async function ensurePayerForOwner(
  supabase: SupabaseClient,
  clinicId: string,
  ownerId: string,
  createdBy?: string | null,
): Promise<BillingPayerRow> {
  const { data: existing, error: exErr } = await supabase
    .from('billing_payers')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (exErr) throw new Error(`No se pudo buscar el pagador: ${exErr.message}`);
  if (existing) return existing as BillingPayerRow;

  const { data: owner, error: ownErr } = await supabase
    .from('owners')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('id', ownerId)
    .maybeSingle();
  if (ownErr || !owner) throw new Error('Titular no encontrado');
  const o = owner as OwnerRow;

  // El CRM del destino guarda el documento en owners.document_id (sin tipo):
  // con documento se asume CC (el tipo se corrige en la ficha del pagador).
  const { data: created, error: insErr } = await supabase
    .from('billing_payers')
    .insert({
      clinic_id: clinicId,
      created_by: createdBy ?? null,
      kind: 'PERSONA',
      doc_type: o.document_id ? 'CC' : CONSUMIDOR_FINAL.docType,
      doc_number: o.document_id ?? CONSUMIDOR_FINAL.docNumber,
      name: o.full_name,
      email: o.email,
      phone: o.phone,
      address: o.address,
      owner_id: o.id,
    })
    .select('*')
    .single();
  if (insErr) throw new Error(`No se pudo crear el pagador: ${insErr.message}`);
  return created as BillingPayerRow;
}

/** Payer genérico "consumidor final" para ventas de mostrador sin identificar. */
export async function getOrCreateConsumidorFinal(
  supabase: SupabaseClient,
  clinicId: string,
  createdBy?: string | null,
): Promise<BillingPayerRow> {
  const { data: existing, error } = await supabase
    .from('billing_payers')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('doc_number', CONSUMIDOR_FINAL.docNumber)
    .is('owner_id', null)
    .maybeSingle();
  if (error) throw new Error(`No se pudo buscar consumidor final: ${error.message}`);
  if (existing) return existing as BillingPayerRow;

  const { data: created, error: insErr } = await supabase
    .from('billing_payers')
    .insert({
      clinic_id: clinicId,
      created_by: createdBy ?? null,
      kind: 'PERSONA',
      doc_type: CONSUMIDOR_FINAL.docType,
      doc_number: CONSUMIDOR_FINAL.docNumber,
      name: CONSUMIDOR_FINAL.name,
    })
    .select('*')
    .single();
  if (insErr) throw new Error(`No se pudo crear consumidor final: ${insErr.message}`);
  return created as BillingPayerRow;
}

export async function getPayer(
  supabase: SupabaseClient,
  clinicId: string,
  payerId: string,
): Promise<BillingPayerRow | null> {
  const { data, error } = await supabase
    .from('billing_payers')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('id', payerId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el pagador: ${error.message}`);
  return (data as BillingPayerRow | null) ?? null;
}

// ─── Rangos de numeración ────────────────────────────────────────────────────

export async function getActiveRange(
  supabase: SupabaseClient,
  clinicId: string,
  docKind: string,
): Promise<NumberingRangeRow | null> {
  const { data, error } = await supabase
    .from('numbering_ranges')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('doc_kind', docKind)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el rango de numeración: ${error.message}`);
  return (data as NumberingRangeRow | null) ?? null;
}

// ─── Facturas ────────────────────────────────────────────────────────────────

export async function listInvoices(
  supabase: SupabaseClient,
  clinicId: string,
  opts: {
    status?: string;
    payerId?: string;
    patientId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  } = {},
): Promise<InvoiceRow[]> {
  let q = supabase
    .from('invoices')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.payerId) q = q.eq('payer_id', opts.payerId);
  if (opts.patientId) q = q.eq('patient_id', opts.patientId);
  if (opts.dateFrom) q = q.gte('created_at', opts.dateFrom);
  if (opts.dateTo) q = q.lte('created_at', opts.dateTo);
  const { data, error } = await q;
  if (error) throw new Error(`No se pudieron listar facturas: ${error.message}`);
  return (data as InvoiceRow[]) ?? [];
}

// ─── Puente CRM ↔ facturación ────────────────────────────────────────────────

export interface UnbilledConsultation {
  consultationId: string;
  startedAt: string;
  patientId: string;
  patientName: string;
  patientSpecies: string | null;
  ownerId: string;
  ownerName: string;
}

/** El resultado de `getUnbilledConsultations`: la página, y cuántas hay de verdad. */
export interface UnbilledConsultationsResult {
  /** Las que se muestran, ya recortadas a `limit`. */
  consultas: UnbilledConsultation[];
  /**
   * Cuántas hay sin facturar en la ventana, aunque no se muestren todas.
   *
   * Existe porque el riel de pendientes anuncia un número y manda acá: si la pantalla dice
   * "(25)" cuando hay 43, el vet cuenta y la app queda mintiendo. Cuando llega al tope no se
   * sabe el total exacto, se sabe que hay al menos ése — `hayMasQueElTope` lo distingue.
   */
  total: number;
}

/**
 * Consultas cerradas recientes que AÚN no tienen factura — "quién necesita factura".
 *
 * ── EL DEFECTO QUE TENÍA, Y NO ERA EL TRUNCAMIENTO ──────────────────────────────────────────────
 *
 * El `.limit(25)` se aplicaba SOBRE LAS CONSULTAS y recién después se descartaban las facturadas.
 * O sea que traía las 25 más recientes y filtraba: si esas 25 estaban todas facturadas, devolvía
 * CERO — con quince sin facturar un mes atrás, invisibles. No era una lista corta, era una lista
 * equivocada, y el síntoma es el peor posible: "Athos dice que tengo 12 y Ventas no muestra
 * ninguna".
 *
 * Ahora el filtro va primero y el recorte al final. Medido contra el principal el 2026-08-22: hoy
 * ninguna clínica pasa de 10 consultas completadas en 60 días, así que el defecto todavía no se
 * ve — pero una clínica con dos consultas diarias llega a 25 en dos semanas.
 *
 * ── Y SE DEJA DE MENTIR SOBRE EL TOTAL ──────────────────────────────────────────────────────────
 *
 * Devuelve `total` además de la página. Es el mismo truncamiento silencioso que ya se corrigió en
 * `getDashboardKpis` y en `getStockMap`, con la misma receta: si se recorta, se dice.
 *
 * LA REGLA VIVE EN `lib/facturacion/sin-facturar` y la comparte con el riel de pendientes. Que las
 * dos respuestas salgan del mismo módulo es lo que impide que vuelvan a separarse — ya pasó con
 * las facturas anuladas, arregladas en los dos lados por separado.
 */
export async function getUnbilledConsultations(
  supabase: SupabaseClient,
  clinicId: string,
  opts: { hoyISO?: string; limit?: number } = {},
): Promise<UnbilledConsultationsResult> {
  const desde = desdeCuando(opts.hoyISO ?? bogotaTodayISO());

  // UNA SOLA QUERY, con el embed de facturas. Antes eran dos —consultas y después sus facturas—
  // y la segunda sólo podía preguntar por las que la primera ya había recortado, que es de donde
  // salía el defecto. `!left` explícito porque lo que interesa son justamente las que NO tienen
  // ninguna: un embed normal las dejaría fuera.
  const { data: consults, error } = await supabase
    .from('consultations')
    .select(
      `id, started_at, patient:patients(id, name, species, owner:owners(id, full_name)), ${EMBED_DE_FACTURAS}`,
    )
    .eq('clinic_id', clinicId)
    .eq('status', 'completed')
    .gte('started_at', desde)
    .order('started_at', { ascending: false })
    .limit(TOPE_SIN_FACTURAR);
  if (error) throw new Error(`No se pudieron leer consultas: ${error.message}`);

  type Row = {
    id: string;
    started_at: string;
    patient: {
      id: string;
      name: string;
      species: string | null;
      owner: { id: string; full_name: string } | null;
    } | null;
    invoices: { status: string }[] | null;
  };

  // El titular hace falta para facturar: sin él la fila no se puede usar aunque esté sin facturar.
  const sinFacturar = soloSinFacturar((consults as unknown as Row[]) ?? []).filter(
    (c) => c.patient?.owner,
  );

  return {
    total: sinFacturar.length,
    consultas: sinFacturar.slice(0, opts.limit ?? 25).map((c) => ({
      consultationId: c.id,
      startedAt: c.started_at,
      patientId: c.patient!.id,
      patientName: c.patient!.name,
      patientSpecies: c.patient!.species,
      ownerId: c.patient!.owner!.id,
      ownerName: c.patient!.owner!.full_name,
    })),
  };
}

/** Facturas EMITIDAS que todavía no se han enviado al cliente. */
export interface FacturacionKpis {
  billedCents: number;
  collectedCents: number;
  issuedCount: number;
  outstandingCents: number;
  openCount: number;
  overdueCount: number;
  draftCount: number;
}

/**
 * KPIs de dinero del home, agregados sobre TODAS las facturas que aplican — no sobre una página.
 * Antes se calculaban en memoria sobre las últimas 100 filas del listado: una clínica con más de
 * 100 facturas veía "Facturado", "Recaudado" y "Por cobrar" truncados sin ningún aviso.
 * Las sumas paginan a paso de 1000 porque ese es el max-rows de PostgREST: pedir más filas
 * devuelve 1000 sin error, que es exactamente la clase de truncamiento silencioso que se arregla.
 */
export async function getDashboardKpis(
  supabase: SupabaseClient,
  clinicId: string,
  monthStartIso: string,
): Promise<FacturacionKpis> {
  const PAGE = 1000;

  let billedCents = 0;
  let collectedCents = 0;
  let issuedCount = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('invoices')
      .select('total_cents, paid_cents')
      .eq('clinic_id', clinicId)
      .eq('status', 'EMITIDA')
      .gte('issued_at', monthStartIso)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`No se pudo sumar lo facturado del mes: ${error.message}`);
    const rows = (data as { total_cents: number; paid_cents: number }[] | null) ?? [];
    billedCents += rows.reduce((a, r) => a + r.total_cents, 0);
    collectedCents += rows.reduce((a, r) => a + r.paid_cents, 0);
    issuedCount += rows.length;
    if (rows.length < PAGE) break;
  }

  let outstandingCents = 0;
  let openCount = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('invoices')
      .select('balance_cents')
      .eq('clinic_id', clinicId)
      .eq('status', 'EMITIDA')
      .gt('balance_cents', 0)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`No se pudo sumar la cartera abierta: ${error.message}`);
    const rows = (data as { balance_cents: number }[] | null) ?? [];
    outstandingCents += rows.reduce((a, r) => a + r.balance_cents, 0);
    openCount += rows.length;
    if (rows.length < PAGE) break;
  }

  const [overdueRes, draftRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('status', 'EMITIDA')
      .gt('balance_cents', 0)
      .eq('collection_status', 'VENCIDA'),
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('status', 'BORRADOR'),
  ]);
  if (overdueRes.error) throw new Error(`No se pudo contar vencidas: ${overdueRes.error.message}`);
  if (draftRes.error) throw new Error(`No se pudo contar borradores: ${draftRes.error.message}`);

  return {
    billedCents,
    collectedCents,
    issuedCount,
    outstandingCents,
    openCount,
    overdueCount: overdueRes.count ?? 0,
    draftCount: draftRes.count ?? 0,
  };
}

export async function getUnsentIssuedCount(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('status', 'EMITIDA')
    .eq('delivery_status', 'NO_ENVIADA');
  if (error) throw new Error(`No se pudo contar facturas sin enviar: ${error.message}`);
  return count ?? 0;
}

export interface InvoiceDetail {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  events: InvoiceEventRow[];
  payer: BillingPayerRow | null;
  fiscalDocuments: FiscalDocumentRow[];
}

export async function getInvoiceDetail(
  supabase: SupabaseClient,
  clinicId: string,
  invoiceId: string,
): Promise<InvoiceDetail | null> {
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('id', invoiceId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la factura: ${error.message}`);
  if (!invoice) return null;
  const inv = invoice as InvoiceRow;

  const [linesRes, eventsRes, fiscalRes, payer] = await Promise.all([
    supabase
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('position', { ascending: true }),
    supabase
      .from('invoice_events')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true }),
    supabase
      .from('fiscal_documents')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true }),
    inv.payer_id ? getPayer(supabase, clinicId, inv.payer_id) : Promise.resolve(null),
  ]);
  if (linesRes.error) throw new Error(`No se pudieron leer líneas: ${linesRes.error.message}`);
  if (eventsRes.error) throw new Error(`No se pudieron leer eventos: ${eventsRes.error.message}`);
  if (fiscalRes.error)
    throw new Error(`No se pudieron leer documentos fiscales: ${fiscalRes.error.message}`);

  return {
    invoice: inv,
    lines: (linesRes.data as InvoiceLineRow[]) ?? [],
    events: (eventsRes.data as InvoiceEventRow[]) ?? [],
    payer,
    fiscalDocuments: (fiscalRes.data as FiscalDocumentRow[]) ?? [],
  };
}

'use server';

// Server actions de compras a proveedores.
// Flujo: borrador (editable) → confirmar (movimientos ENTRADA_COMPRA + lotes +
// último costo + egreso automático) → anular (revierte movimientos y egreso).
//
// Idempotencia de confirmar: transición condicional `status='BORRADOR' →
// 'CONFIRMADA'` con .select() — solo quien gana la transición ejecuta los
// efectos. Red de seguridad extra: UNIQUE parcial de expenses.purchase_id.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { CatalogItemRow, PurchaseItemRow, PurchaseRow } from '@/lib/supabase/types';
import {
  computePurchaseTotalCents,
  costPerUseUnitCents,
  validatePurchaseLines,
  type PurchaseLineInput,
} from '@/lib/facturacion/domain/purchases';

type Err = { ok: false; error: string };
export type PurchaseResult<P = unknown> = ({ ok: true } & P) | Err;

const PAYMENT_METHODS = [
  'EFECTIVO',
  'TRANSFERENCIA',
  'NEQUI',
  'DAVIPLATA',
  'TARJETA',
  'ENLACE',
  'OTRO',
] as const;

async function requireClinic() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('No autenticado');
  const { data: prof } = await supabase
    .from('profiles')
    .select('clinic_id')
    .eq('id', user.id)
    .maybeSingle();
  const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id ?? null;
  if (!clinicId) throw new Error('El usuario no tiene clínica');
  return { supabase, clinicId, userId: user.id };
}

function toError(e: unknown): Err {
  return { ok: false, error: e instanceof Error ? e.message : 'Error inesperado' };
}

function revalidatePurchases() {
  revalidatePath('/dashboard/facturacion/compras');
  revalidatePath('/dashboard/facturacion/inventario');
  revalidatePath('/dashboard/facturacion/finanzas');
}

const LineSchema = z.object({
  catalogItemId: z.string().uuid(),
  qty: z.number().positive(),
  unitCostCents: z.number().int().min(0),
  lotCode: z.string().trim().max(60).nullish(),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});

const DraftSchema = z.object({
  id: z.string().uuid().nullish(),
  supplierId: z.string().uuid().nullish(),
  purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  docNumber: z.string().trim().max(60).nullish(),
  method: z.enum(PAYMENT_METHODS).nullish(),
  note: z.string().trim().max(300).nullish(),
  lines: z.array(LineSchema).min(1, 'La compra necesita al menos una línea').max(200),
});

export type PurchaseDraftInput = z.input<typeof DraftSchema>;

/** Crea o edita una compra en BORRADOR. El total SIEMPRE se calcula acá. */
export async function savePurchaseDraft(
  input: PurchaseDraftInput,
): Promise<PurchaseResult<{ id: string }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const d = DraftSchema.parse(input);

    const lines: PurchaseLineInput[] = d.lines.map((l) => ({
      catalogItemId: l.catalogItemId,
      qty: l.qty,
      unitCostCents: l.unitCostCents,
      lotCode: l.lotCode ?? null,
      expiresOn: l.expiresOn ?? null,
    }));
    const problem = validatePurchaseLines(lines);
    if (problem) return { ok: false, error: problem };

    const payload = {
      supplier_id: d.supplierId ?? null,
      purchased_on: d.purchasedOn,
      doc_number: d.docNumber ?? null,
      method: d.method ?? null,
      note: d.note ?? null,
      total_cents: computePurchaseTotalCents(lines),
    };

    let purchaseId: string;
    if (d.id) {
      // Solo se edita un borrador.
      const { data, error } = await supabase
        .from('purchases')
        .update(payload)
        .eq('id', d.id)
        .eq('clinic_id', clinicId)
        .eq('status', 'BORRADOR')
        .select('id')
        .maybeSingle();
      if (error) return { ok: false, error: `No se pudo guardar la compra: ${error.message}` };
      if (!data) return { ok: false, error: 'La compra ya no es un borrador editable' };
      purchaseId = (data as { id: string }).id;
      const { error: delErr } = await supabase
        .from('purchase_items')
        .delete()
        .eq('purchase_id', purchaseId)
        .eq('clinic_id', clinicId);
      if (delErr) return { ok: false, error: `No se pudieron actualizar las líneas: ${delErr.message}` };
    } else {
      const { data, error } = await supabase
        .from('purchases')
        .insert({ clinic_id: clinicId, created_by: userId, status: 'BORRADOR', ...payload })
        .select('id')
        .single();
      if (error) return { ok: false, error: `No se pudo crear la compra: ${error.message}` };
      purchaseId = (data as { id: string }).id;
    }

    const { error: linesErr } = await supabase.from('purchase_items').insert(
      lines.map((l) => ({
        clinic_id: clinicId,
        created_by: userId,
        purchase_id: purchaseId,
        catalog_item_id: l.catalogItemId,
        qty: l.qty,
        unit_cost_cents: l.unitCostCents,
        lot_code: l.lotCode,
        expires_on: l.expiresOn,
      })),
    );
    if (linesErr) return { ok: false, error: `No se pudieron guardar las líneas: ${linesErr.message}` };

    revalidatePurchases();
    return { ok: true, id: purchaseId };
  } catch (e) {
    return toError(e);
  }
}

/** Confirma la compra: stock + lotes + último costo + egreso automático. */
export async function confirmPurchaseAction(input: {
  id: string;
}): Promise<PurchaseResult> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const id = z.string().uuid().parse(input.id);

    // Transición condicional: solo UNA ejecución gana el derecho a los efectos.
    const { data: won, error: trErr } = await supabase
      .from('purchases')
      .update({ status: 'CONFIRMADA', confirmed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .eq('status', 'BORRADOR')
      .select('*')
      .maybeSingle();
    if (trErr) return { ok: false, error: `No se pudo confirmar: ${trErr.message}` };
    if (!won) return { ok: false, error: 'La compra ya fue confirmada o anulada' };
    const purchase = won as PurchaseRow;

    const { data: rawLines, error: linesErr } = await supabase
      .from('purchase_items')
      .select('*')
      .eq('purchase_id', id)
      .eq('clinic_id', clinicId);
    if (linesErr) return { ok: false, error: `No se pudieron leer las líneas: ${linesErr.message}` };
    const lines = (rawLines as PurchaseItemRow[]) ?? [];
    if (lines.length === 0) return { ok: false, error: 'La compra no tiene líneas' };

    const itemIds = [...new Set(lines.map((l) => l.catalog_item_id))];
    const { data: rawItems, error: itemsErr } = await supabase
      .from('catalog_items')
      .select('id, conversion_factor, track_stock')
      .eq('clinic_id', clinicId)
      .in('id', itemIds);
    if (itemsErr) return { ok: false, error: `No se pudo leer el catálogo: ${itemsErr.message}` };
    const items = (rawItems as Pick<CatalogItemRow, 'id' | 'conversion_factor' | 'track_stock'>[]) ?? [];
    const itemsById = new Map(
      items.map((i) => [i.id, { conversionFactor: i.conversion_factor, trackStock: i.track_stock }]),
    );

    // Lotes: reutiliza el lote (item, código) si ya existe; si no, lo crea.
    const lotIdByLine = new Map<string, string | null>();
    for (const l of lines) {
      if (!l.lot_code || !itemsById.get(l.catalog_item_id)?.trackStock) {
        lotIdByLine.set(l.id, null);
        continue;
      }
      const { data: existing } = await supabase
        .from('catalog_lots')
        .select('id')
        .eq('item_id', l.catalog_item_id)
        .eq('lot_code', l.lot_code)
        .maybeSingle();
      if (existing) {
        lotIdByLine.set(l.id, (existing as { id: string }).id);
        continue;
      }
      const { data: created, error: lotErr } = await supabase
        .from('catalog_lots')
        .insert({ item_id: l.catalog_item_id, lot_code: l.lot_code, expires_on: l.expires_on })
        .select('id')
        .single();
      if (lotErr) return { ok: false, error: `No se pudo crear el lote «${l.lot_code}»: ${lotErr.message}` };
      lotIdByLine.set(l.id, (created as { id: string }).id);
    }

    // Movimientos ENTRADA_COMPRA en unidad de USO.
    const moveByLine = lines.flatMap((l) => {
      const info = itemsById.get(l.catalog_item_id);
      if (!info?.trackStock) return [];
      return [
        {
          clinic_id: clinicId,
          created_by: userId,
          item_id: l.catalog_item_id,
          lot_id: lotIdByLine.get(l.id) ?? null,
          qty: l.qty * (info.conversionFactor || 1),
          movement_type: 'ENTRADA_COMPRA',
          ref_type: 'PURCHASE',
          ref_id: id,
          note: purchase.doc_number ? `Compra ${purchase.doc_number}` : 'Compra a proveedor',
        },
      ];
    });
    if (moveByLine.length > 0) {
      const { error: movErr } = await supabase.from('inventory_movements').insert(moveByLine);
      if (movErr) return { ok: false, error: `No se pudo registrar el stock: ${movErr.message}` };
    }

    // Último costo por unidad de USO (si un ítem viene en varias líneas, la última gana).
    for (const l of lines) {
      const info = itemsById.get(l.catalog_item_id);
      if (!info) continue;
      await supabase
        .from('catalog_items')
        .update({ cost_cents: costPerUseUnitCents(l.unit_cost_cents, info.conversionFactor) })
        .eq('id', l.catalog_item_id)
        .eq('clinic_id', clinicId);
    }

    // Egreso automático 1:1 (el UNIQUE parcial de purchase_id evita duplicados).
    const { error: expErr } = await supabase.from('expenses').insert({
      clinic_id: clinicId,
      created_by: userId,
      category: 'COMPRA_INVENTARIO',
      amount_cents: purchase.total_cents,
      expense_date: purchase.purchased_on,
      method: purchase.method ?? 'OTRO',
      supplier_id: purchase.supplier_id,
      note: purchase.doc_number ? `Compra ${purchase.doc_number}` : null,
      purchase_id: id,
    });
    if (expErr && expErr.code !== '23505') {
      return {
        ok: false,
        error: `La compra quedó confirmada pero falló el egreso: ${expErr.message}. Anúlala e inténtalo de nuevo.`,
      };
    }

    revalidatePurchases();
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

/**
 * Anula una compra CONFIRMADA: borra sus movimientos y su egreso. No revierte
 * cost_cents (regla «último costo» sin historial; el vet lo ajusta en catálogo
 * si hace falta).
 */
export async function annulPurchaseAction(input: { id: string }): Promise<PurchaseResult> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const id = z.string().uuid().parse(input.id);

    const { data: won, error: trErr } = await supabase
      .from('purchases')
      .update({ status: 'ANULADA', annulled_at: new Date().toISOString() })
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .eq('status', 'CONFIRMADA')
      .select('id')
      .maybeSingle();
    if (trErr) return { ok: false, error: `No se pudo anular: ${trErr.message}` };
    if (!won) return { ok: false, error: 'Solo se anula una compra confirmada' };

    const { error: movErr } = await supabase
      .from('inventory_movements')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('ref_type', 'PURCHASE')
      .eq('ref_id', id);
    if (movErr) return { ok: false, error: `No se pudieron revertir los movimientos: ${movErr.message}` };

    const { error: expErr } = await supabase
      .from('expenses')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('purchase_id', id);
    if (expErr) return { ok: false, error: `No se pudo eliminar el egreso: ${expErr.message}` };

    revalidatePurchases();
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

/**
 * Reabre una compra CONFIRMADA para editarla: revierte sus movimientos y su
 * egreso, y la deja en BORRADOR. Al re-confirmar se vuelven a aplicar los
 * efectos con los valores editados. (El «último costo» no se revierte.)
 */
export async function reopenPurchaseAction(input: { id: string }): Promise<PurchaseResult> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const id = z.string().uuid().parse(input.id);

    const { data: won, error: trErr } = await supabase
      .from('purchases')
      .update({ status: 'BORRADOR', confirmed_at: null })
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .eq('status', 'CONFIRMADA')
      .select('id')
      .maybeSingle();
    if (trErr) return { ok: false, error: `No se pudo reabrir: ${trErr.message}` };
    if (!won) return { ok: false, error: 'Solo se reabre una compra confirmada' };

    const { error: movErr } = await supabase
      .from('inventory_movements')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('ref_type', 'PURCHASE')
      .eq('ref_id', id);
    if (movErr) return { ok: false, error: `No se pudieron revertir los movimientos: ${movErr.message}` };

    const { error: expErr } = await supabase
      .from('expenses')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('purchase_id', id);
    if (expErr) return { ok: false, error: `No se pudo revertir el egreso: ${expErr.message}` };

    revalidatePurchases();
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

/** Borra un BORRADOR (las confirmadas se anulan, no se borran). */
export async function deletePurchaseDraftAction(input: { id: string }): Promise<PurchaseResult> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const id = z.string().uuid().parse(input.id);
    const { data, error } = await supabase
      .from('purchases')
      .delete()
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .eq('status', 'BORRADOR')
      .select('id')
      .maybeSingle();
    if (error) return { ok: false, error: `No se pudo borrar el borrador: ${error.message}` };
    if (!data) return { ok: false, error: 'Solo se borra una compra en borrador' };
    revalidatePurchases();
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

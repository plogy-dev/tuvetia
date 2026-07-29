'use server';

// Server actions de egresos. Gastos manuales por categoría cerrada, con
// comprobante opcional en el bucket privado `receipts` (path por clínica:
// <clinic_id>/expenses/…). Los egresos automáticos de compras (purchase_id)
// NO se borran desde acá: se anulan desde la compra que los generó.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { EXPENSE_CATEGORIES } from '@/lib/facturacion/domain/finance';

type Err = { ok: false; error: string };
export type ExpenseResult<P = unknown> = ({ ok: true } & P) | Err;

const PAYMENT_METHODS = [
  'EFECTIVO',
  'TRANSFERENCIA',
  'NEQUI',
  'DAVIPLATA',
  'TARJETA',
  'ENLACE',
  'OTRO',
] as const;

/** Bucket único de comprobantes del destino (contrato §4): path por clínica. */
const RECEIPTS_BUCKET = 'receipts';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB
const ATTACHMENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

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

const ExpenseSchema = z.object({
  id: z.string().uuid().nullish(),
  category: z.enum(EXPENSE_CATEGORIES),
  amountCents: z.number().int().positive('El monto debe ser mayor a cero'),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  method: z.enum(PAYMENT_METHODS),
  supplierId: z.string().uuid().nullish(),
  note: z.string().trim().max(300).nullish(),
});

/**
 * Crea o edita un gasto manual; el comprobante (pdf/jpg/png ≤ 5 MB) es
 * opcional (al editar, uno nuevo reemplaza al anterior). Los egresos generados
 * por compras (purchase_id) no se editan acá: se reabre/anula la compra.
 */
export async function registerExpenseAction(
  formData: FormData,
): Promise<ExpenseResult<{ id: string }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const d = ExpenseSchema.parse({
      id: (formData.get('id') as string) || null,
      category: formData.get('category'),
      amountCents: Math.round(Number(formData.get('amountPesos') ?? 0) * 100),
      expenseDate: formData.get('expenseDate'),
      method: formData.get('method'),
      supplierId: (formData.get('supplierId') as string) || null,
      note: (formData.get('note') as string) || null,
    });

    let previousAttachment: string | null = null;
    if (d.id) {
      const { data: existing } = await supabase
        .from('expenses')
        .select('purchase_id, attachment_path')
        .eq('id', d.id)
        .eq('clinic_id', clinicId)
        .maybeSingle<{ purchase_id: string | null; attachment_path: string | null }>();
      if (!existing) return { ok: false, error: 'Gasto no encontrado' };
      if (existing.purchase_id) {
        return {
          ok: false,
          error: 'Este egreso lo generó una compra: edítalo reabriendo la compra',
        };
      }
      previousAttachment = existing.attachment_path;
    }

    let attachmentPath: string | null = null;
    const file = formData.get('attachment');
    if (file instanceof File && file.size > 0) {
      const ext = ATTACHMENT_TYPES[file.type];
      if (!ext) return { ok: false, error: 'Comprobante no soportado (usa PDF, JPG o PNG)' };
      if (file.size > MAX_ATTACHMENT_BYTES) {
        return { ok: false, error: 'El comprobante supera 5 MB' };
      }
      attachmentPath = `${clinicId}/expenses/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(RECEIPTS_BUCKET)
        .upload(attachmentPath, file, { contentType: file.type });
      if (upErr) return { ok: false, error: `No se pudo subir el comprobante: ${upErr.message}` };
    }

    const payload = {
      category: d.category,
      amount_cents: d.amountCents,
      expense_date: d.expenseDate,
      method: d.method,
      supplier_id: d.supplierId ?? null,
      note: d.note ?? null,
      // Sin archivo nuevo, el comprobante existente se conserva.
      ...(attachmentPath ? { attachment_path: attachmentPath } : {}),
    };

    let id: string;
    if (d.id) {
      const { error } = await supabase
        .from('expenses')
        .update(payload)
        .eq('id', d.id)
        .eq('clinic_id', clinicId);
      if (error) return { ok: false, error: `No se pudo editar el gasto: ${error.message}` };
      id = d.id;
      if (attachmentPath && previousAttachment) {
        await supabase.storage.from(RECEIPTS_BUCKET).remove([previousAttachment]);
      }
    } else {
      const { data, error } = await supabase
        .from('expenses')
        .insert({
          clinic_id: clinicId,
          created_by: userId,
          attachment_path: attachmentPath,
          ...payload,
        })
        .select('id')
        .single();
      if (error) return { ok: false, error: `No se pudo registrar el gasto: ${error.message}` };
      id = (data as { id: string }).id;
    }

    revalidatePath('/dashboard/facturacion/finanzas');
    return { ok: true, id };
  } catch (e) {
    return toError(e);
  }
}

/** Borra un gasto MANUAL (los de compra se anulan desde la compra). */
export async function deleteExpenseAction(input: { id: string }): Promise<ExpenseResult> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const id = z.string().uuid().parse(input.id);

    const { data: exp } = await supabase
      .from('expenses')
      .select('id, purchase_id, attachment_path')
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .maybeSingle<{ id: string; purchase_id: string | null; attachment_path: string | null }>();
    if (!exp) return { ok: false, error: 'Gasto no encontrado' };
    if (exp.purchase_id) {
      return {
        ok: false,
        error: 'Este egreso lo generó una compra de inventario: anula la compra para eliminarlo',
      };
    }

    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', id)
      .eq('clinic_id', clinicId);
    if (error) return { ok: false, error: `No se pudo eliminar el gasto: ${error.message}` };
    if (exp.attachment_path) {
      await supabase.storage.from(RECEIPTS_BUCKET).remove([exp.attachment_path]);
    }

    revalidatePath('/dashboard/facturacion/finanzas');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

/** URL firmada (60 s) para ver un comprobante. */
export async function getExpenseAttachmentUrlAction(input: {
  id: string;
}): Promise<ExpenseResult<{ url: string }>> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const id = z.string().uuid().parse(input.id);

    const { data: exp } = await supabase
      .from('expenses')
      .select('attachment_path')
      .eq('id', id)
      .eq('clinic_id', clinicId)
      .maybeSingle<{ attachment_path: string | null }>();
    if (!exp?.attachment_path) return { ok: false, error: 'El gasto no tiene comprobante' };

    const { data, error } = await supabase.storage
      .from(RECEIPTS_BUCKET)
      .createSignedUrl(exp.attachment_path, 60);
    if (error || !data?.signedUrl) {
      return { ok: false, error: 'No se pudo generar el enlace del comprobante' };
    }
    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return toError(e);
  }
}

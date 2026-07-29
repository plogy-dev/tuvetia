'use server';

// Server actions de INGRESOS sueltos (payments sin aplicación a factura).
// Los pagos aplicados a una factura NO se tocan desde acá: su verdad vive en
// invoice_events (PAYMENT_APPLIED) y se gestionan desde la factura — editarlos
// directo dejaría los caches (paid/balance) inconsistentes.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type Err = { ok: false; error: string };
export type PaymentResult<P = unknown> = ({ ok: true } & P) | Err;

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

const IncomeSchema = z.object({
  id: z.string().uuid().nullish(),
  method: z.enum(PAYMENT_METHODS),
  amountCents: z.number().int().positive('El monto debe ser mayor a cero'),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  note: z.string().trim().max(300).nullish(),
});

/** ¿El pago está aplicado a alguna factura? (→ no editable suelto). */
async function isApplied(
  supabase: Awaited<ReturnType<typeof requireClinic>>['supabase'],
  paymentId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from('payment_applications')
    .select('id', { count: 'exact', head: true })
    .eq('payment_id', paymentId);
  return (count ?? 0) > 0;
}

/** Crea o edita un ingreso suelto (no ligado a factura). */
export async function upsertIncomeAction(
  formData: FormData,
): Promise<PaymentResult<{ id: string }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const d = IncomeSchema.parse({
      id: (formData.get('id') as string) || null,
      method: formData.get('method'),
      amountCents: Math.round(Number(formData.get('amountPesos') ?? 0) * 100),
      receivedDate: formData.get('receivedDate'),
      note: (formData.get('note') as string) || null,
    });
    // Mediodía Bogotá: cae en el día correcto en cualquier agrupación.
    const receivedAt = `${d.receivedDate}T12:00:00-05:00`;
    const payload = {
      method: d.method,
      amount_cents: d.amountCents,
      note: d.note ?? null,
      received_at: receivedAt,
    };

    if (d.id) {
      if (await isApplied(supabase, d.id)) {
        return {
          ok: false,
          error: 'Este pago está aplicado a una factura: se gestiona desde la factura',
        };
      }
      const { data, error } = await supabase
        .from('payments')
        .update(payload)
        .eq('id', d.id)
        .eq('clinic_id', clinicId)
        .select('id')
        .maybeSingle();
      if (error) return { ok: false, error: `No se pudo editar el ingreso: ${error.message}` };
      if (!data) return { ok: false, error: 'Ingreso no encontrado' };
    } else {
      const { data, error } = await supabase
        .from('payments')
        .insert({ clinic_id: clinicId, created_by: userId, ...payload })
        .select('id')
        .single();
      if (error) return { ok: false, error: `No se pudo registrar el ingreso: ${error.message}` };
      revalidatePath('/dashboard/facturacion/finanzas');
      return { ok: true, id: (data as { id: string }).id };
    }

    revalidatePath('/dashboard/facturacion/finanzas');
    return { ok: true, id: d.id! };
  } catch (e) {
    return toError(e);
  }
}

/** Borra un ingreso suelto (los aplicados a factura no se borran desde acá). */
export async function deleteIncomeAction(input: { id: string }): Promise<PaymentResult> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const id = z.string().uuid().parse(input.id);
    if (await isApplied(supabase, id)) {
      return {
        ok: false,
        error: 'Este pago está aplicado a una factura: se gestiona desde la factura',
      };
    }
    const { error } = await supabase
      .from('payments')
      .delete()
      .eq('id', id)
      .eq('clinic_id', clinicId);
    if (error) return { ok: false, error: `No se pudo borrar el ingreso: ${error.message}` };
    revalidatePath('/dashboard/facturacion/finanzas');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

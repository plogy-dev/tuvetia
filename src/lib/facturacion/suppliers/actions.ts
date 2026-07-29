'use server';

// Server actions de proveedores. CRUD simple por clínica: crear/editar y
// activar/desactivar. El nombre es único (case-insensitive) entre los activos.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type Err = { ok: false; error: string };
export type SupplierResult<P = unknown> = ({ ok: true } & P) | Err;

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

function revalidateSuppliers() {
  revalidatePath('/dashboard/facturacion/compras/proveedores');
  revalidatePath('/dashboard/facturacion/compras');
  revalidatePath('/dashboard/facturacion/catalogo');
}

const SupplierSchema = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().trim().min(1, 'Nombre requerido').max(120),
  nit: z.string().trim().max(30).nullish(),
  phone: z.string().trim().max(30).nullish(),
  email: z.string().trim().email('Email inválido').max(160).nullish().or(z.literal('')),
  notes: z.string().trim().max(500).nullish(),
});

/** Crea o edita un proveedor. */
export async function upsertSupplierAction(input: {
  id?: string | null;
  name: string;
  nit?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}): Promise<SupplierResult<{ id: string }>> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const d = SupplierSchema.parse(input);
    const payload = {
      name: d.name,
      nit: d.nit || null,
      phone: d.phone || null,
      email: d.email || null,
      notes: d.notes || null,
    };
    const query = d.id
      ? supabase.from('suppliers').update(payload).eq('id', d.id).eq('clinic_id', clinicId)
      : supabase.from('suppliers').insert({ clinic_id: clinicId, created_by: userId, ...payload });
    const { data, error } = await query.select('id').single();
    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: 'Ya existe un proveedor con ese nombre' };
      }
      return { ok: false, error: `No se pudo guardar el proveedor: ${error.message}` };
    }
    revalidateSuppliers();
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return toError(e);
  }
}

/** Activa o desactiva un proveedor (no se borra: las compras lo referencian). */
export async function setSupplierActiveAction(input: {
  id: string;
  active: boolean;
}): Promise<SupplierResult> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const { id, active } = z
      .object({ id: z.string().uuid(), active: z.boolean() })
      .parse(input);
    const { error } = await supabase
      .from('suppliers')
      .update({ active })
      .eq('id', id)
      .eq('clinic_id', clinicId);
    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: 'Ya hay un proveedor activo con ese nombre' };
      }
      return { ok: false, error: `No se pudo actualizar el proveedor: ${error.message}` };
    }
    revalidateSuppliers();
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

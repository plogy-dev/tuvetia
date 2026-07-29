// Tareas humanas de cartera: escalamiento a una persona de la clínica.
// El índice único human_tasks_open_uidx garantiza UNA sola tarea abierta por
// (factura, tipo); aquí se maneja el conflicto para no duplicar (§9).
//
// resolved_by es ATRIBUCIÓN (perfil de quien resuelve): viaja como parámetro
// aparte del clinic_id (contrato §1); null cuando resuelve el sistema.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HumanTaskKind, HumanTaskRow } from '@/lib/supabase/types';

export async function openHumanTask(
  supabase: SupabaseClient,
  clinicId: string,
  args: {
    kind: HumanTaskKind;
    invoiceId?: string | null;
    ownerId?: string | null;
    title: string;
    payload?: Record<string, unknown>;
    createdBy?: string | null;
  },
): Promise<{ taskId: string; created: boolean }> {
  // ¿Ya hay una abierta para esta (factura, tipo)?
  if (args.invoiceId) {
    const { data: existing } = await supabase
      .from('human_tasks')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('invoice_id', args.invoiceId)
      .eq('kind', args.kind)
      .in('status', ['ABIERTA', 'EN_PROGRESO'])
      .maybeSingle();
    if (existing) return { taskId: (existing as { id: string }).id, created: false };
  }

  const { data, error } = await supabase
    .from('human_tasks')
    .insert({
      clinic_id: clinicId,
      created_by: args.createdBy ?? null,
      kind: args.kind,
      invoice_id: args.invoiceId ?? null,
      owner_id: args.ownerId ?? null,
      title: args.title,
      payload: args.payload ?? null,
      status: 'ABIERTA',
    })
    .select('id')
    .single();

  if (error) {
    // Carrera con el índice único parcial: alguien la creó en paralelo.
    if (error.code === '23505' && args.invoiceId) {
      const { data: race } = await supabase
        .from('human_tasks')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('invoice_id', args.invoiceId)
        .eq('kind', args.kind)
        .in('status', ['ABIERTA', 'EN_PROGRESO'])
        .maybeSingle();
      if (race) return { taskId: (race as { id: string }).id, created: false };
    }
    throw new Error(`No se pudo abrir la tarea: ${error.message}`);
  }

  if (args.invoiceId) {
    await supabase.from('invoice_events').insert({
      invoice_id: args.invoiceId,
      event_type: 'HUMAN_TASK_OPENED',
      payload: { kind: args.kind, taskId: (data as { id: string }).id },
    });
  }
  return { taskId: (data as { id: string }).id, created: true };
}

export async function resolveHumanTask(
  supabase: SupabaseClient,
  clinicId: string,
  taskId: string,
  status: 'RESUELTA' | 'DESCARTADA',
  resolvedBy?: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('human_tasks')
    .update({ status, resolved_by: resolvedBy ?? null, resolved_at: new Date().toISOString() })
    .eq('clinic_id', clinicId)
    .eq('id', taskId)
    .select('invoice_id, kind')
    .single();
  if (error) throw new Error(`No se pudo resolver la tarea: ${error.message}`);
  const row = data as Pick<HumanTaskRow, 'invoice_id' | 'kind'>;
  if (row.invoice_id) {
    await supabase.from('invoice_events').insert({
      invoice_id: row.invoice_id,
      event_type: 'HUMAN_TASK_RESOLVED',
      payload: { kind: row.kind, taskId, status },
    });
  }
}

// ─── Tarea clinic-level de reconexión de canal ───────────────────────────────

function reauthTaskTitle(provider: 'whatsapp'): string {
  return provider === 'whatsapp'
    ? 'Reconectar WhatsApp para seguir cobrando'
    : 'Reconectar el canal de cobranza';
}

/**
 * Garantiza UNA tarea abierta (sin factura, a nivel de la clínica) avisando que
 * un canal de cobranza necesita reconectarse. Dedup por título: no spamea entre
 * barridos. La programación de recordatorios NO se pierde (el despachador ya
 * reprograma el envío transitorio); esto solo la hace visible en la bandeja.
 * (El caso 'google'/Gmail del cliente se OMITIÓ: el destino no tiene email.)
 */
export async function ensureReauthTask(
  supabase: SupabaseClient,
  clinicId: string,
  provider: 'whatsapp',
): Promise<void> {
  const title = reauthTaskTitle(provider);
  const { data: existing } = await supabase
    .from('human_tasks')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('kind', 'OTRO')
    .is('invoice_id', null)
    .eq('title', title)
    .in('status', ['ABIERTA', 'EN_PROGRESO'])
    .maybeSingle();
  if (existing) return;
  await supabase.from('human_tasks').insert({
    clinic_id: clinicId,
    kind: 'OTRO',
    invoice_id: null,
    owner_id: null,
    title,
    payload: { reason: 'REAUTH', provider },
    status: 'ABIERTA',
  });
}

/** Cierra la tarea de reconexión cuando el canal vuelve a estar activo. */
export async function clearReauthTask(
  supabase: SupabaseClient,
  clinicId: string,
  provider: 'whatsapp',
  resolvedBy?: string | null,
): Promise<void> {
  await supabase
    .from('human_tasks')
    .update({
      status: 'RESUELTA',
      resolved_by: resolvedBy ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('clinic_id', clinicId)
    .eq('kind', 'OTRO')
    .is('invoice_id', null)
    .eq('title', reauthTaskTitle(provider))
    .in('status', ['ABIERTA', 'EN_PROGRESO']);
}

export async function listOpenTasks(supabase: SupabaseClient, clinicId: string) {
  const { data, error } = await supabase
    .from('human_tasks')
    .select('*')
    .eq('clinic_id', clinicId)
    .in('status', ['ABIERTA', 'EN_PROGRESO'])
    .order('created_at', { ascending: true });
  if (error) throw new Error(`No se pudieron leer las tareas: ${error.message}`);
  return (data ?? []) as HumanTaskRow[];
}

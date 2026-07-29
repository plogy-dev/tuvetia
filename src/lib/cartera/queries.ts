import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CommMessageRow,
  HumanTaskRow,
  InvoiceReminderRow,
  InvoiceRow,
} from '@/lib/supabase/types';

export type CarteraInvoice = Pick<
  InvoiceRow,
  | 'id'
  | 'full_number'
  | 'total_cents'
  | 'paid_cents'
  | 'balance_cents'
  | 'due_date'
  | 'collection_status'
  | 'followup_status'
  | 'followup_channel'
> & { payer: { name: string } | null };

/** Facturas con saldo (cartera viva), ordenadas por vencimiento. */
export async function getOpenReceivables(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<CarteraInvoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select(
      'id, full_number, total_cents, paid_cents, balance_cents, due_date, collection_status, followup_status, followup_channel, payer:billing_payers(name)',
    )
    .eq('clinic_id', clinicId)
    .eq('status', 'EMITIDA')
    .gt('balance_cents', 0)
    .order('due_date', { ascending: true });
  if (error) throw new Error(`No se pudo leer la cartera: ${error.message}`);
  return (data as unknown as CarteraInvoice[]) ?? [];
}

/** Próximos recordatorios programados (agenda de cobranza). */
export async function getUpcomingReminders(
  supabase: SupabaseClient,
  clinicId: string,
  limit = 20,
): Promise<(InvoiceReminderRow & { invoice: { full_number: string | null } | null })[]> {
  const { data, error } = await supabase
    .from('invoice_reminders')
    .select('*, invoice:invoices!inner(full_number, clinic_id)')
    .eq('invoice.clinic_id', clinicId)
    .eq('status', 'PENDIENTE')
    .order('scheduled_for', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`No se pudieron leer recordatorios: ${error.message}`);
  return (data as unknown as (InvoiceReminderRow & {
    invoice: { full_number: string | null } | null;
  })[]) ?? [];
}

export async function getOpenHumanTasks(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<(HumanTaskRow & { invoice: { full_number: string | null } | null })[]> {
  const { data, error } = await supabase
    .from('human_tasks')
    .select('*, invoice:invoices(full_number)')
    .eq('clinic_id', clinicId)
    .in('status', ['ABIERTA', 'EN_PROGRESO'])
    .order('created_at', { ascending: true });
  if (error) throw new Error(`No se pudieron leer las tareas: ${error.message}`);
  return (data as unknown as (HumanTaskRow & {
    invoice: { full_number: string | null } | null;
  })[]) ?? [];
}

/** Timeline omnicanal de una factura: mensajes de cartera (saliente/entrante). */
export async function getInvoiceCommMessages(
  supabase: SupabaseClient,
  clinicId: string,
  invoiceId: string,
): Promise<CommMessageRow[]> {
  const { data, error } = await supabase
    .from('comm_messages')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`No se pudieron leer las comunicaciones: ${error.message}`);
  return (data ?? []) as CommMessageRow[];
}

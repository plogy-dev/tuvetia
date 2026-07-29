'use server';

// Server actions del motor de cartera. Mismo patrón que facturación:
// argumentos tipados + Result, autenticación por sesión, RLS de backstop.
// Estas acciones registran EVENTOS (no editan estado a mano): el recaudo y el
// seguimiento se derivan de invoice_events (deriveStatus / deriveFollowupStatus).

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { refreshInvoiceStatus } from '@/lib/facturacion/invoices';
import { getBillingSettings } from '@/lib/facturacion/queries';
import { runCarteraSweepForClinic } from './scheduler';
import { resolveHumanTask } from './tasks';
import { grantAuthorization, revokeAuthorization } from './authorizations';

type Err = { ok: false; error: string };
export type Result<P = unknown> = ({ ok: true } & P) | Err;

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

async function appendEventAndRefresh(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  invoiceId: string,
  eventType: string,
  payload?: Record<string, unknown>,
) {
  const { error } = await supabase
    .from('invoice_events')
    .insert({ invoice_id: invoiceId, event_type: eventType, payload: payload ?? null });
  if (error) throw new Error(`No se pudo registrar el evento: ${error.message}`);
  await refreshInvoiceStatus(supabase, clinicId, invoiceId);
}

const InvoiceIdSchema = z.object({ invoiceId: z.string().uuid() });

/** Pausar / reanudar el seguimiento de una factura (evento, no edición). */
export async function setRemindersPausedAction(
  input: z.input<typeof InvoiceIdSchema> & { paused: boolean },
): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const { invoiceId } = InvoiceIdSchema.parse(input);
    await appendEventAndRefresh(
      supabase,
      clinicId,
      invoiceId,
      input.paused ? 'REMINDERS_PAUSED' : 'REMINDERS_RESUMED',
    );
    revalidatePath(`/dashboard/facturacion/${invoiceId}`);
    revalidatePath('/dashboard/facturacion/cartera');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

const PromiseSchema = z.object({
  invoiceId: z.string().uuid(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)'),
});

/** Registrar una promesa de pago: pausa el seguimiento hasta la fecha. */
export async function registerPromiseToPayAction(
  input: z.input<typeof PromiseSchema>,
): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const d = PromiseSchema.parse(input);
    await appendEventAndRefresh(supabase, clinicId, d.invoiceId, 'PROMISE_TO_PAY', {
      until: `${d.until}T23:59:59`,
    });
    revalidatePath(`/dashboard/facturacion/${d.invoiceId}`);
    revalidatePath('/dashboard/facturacion/cartera');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

/** Abrir / cerrar disputa (detiene o reanuda cobranza según el estado). */
export async function setDisputeAction(
  input: z.input<typeof InvoiceIdSchema> & { open: boolean },
): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const { invoiceId } = InvoiceIdSchema.parse(input);
    await appendEventAndRefresh(
      supabase,
      clinicId,
      invoiceId,
      input.open ? 'DISPUTE_OPENED' : 'DISPUTE_CLOSED',
    );
    revalidatePath(`/dashboard/facturacion/${invoiceId}`);
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

const AuthSchema = z.object({
  ownerId: z.string().uuid(),
  channel: z.enum(['WHATSAPP', 'EMAIL']),
  invoiceId: z.string().uuid().nullish(),
});

export async function grantAuthorizationAction(
  input: z.input<typeof AuthSchema> & { source?: string },
): Promise<Result> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const d = AuthSchema.parse(input);
    await grantAuthorization(supabase, clinicId, {
      ownerId: d.ownerId,
      channel: d.channel,
      source: input.source,
      createdBy: userId,
    });
    if (d.invoiceId) revalidatePath(`/dashboard/facturacion/${d.invoiceId}`);
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

export async function revokeAuthorizationAction(
  input: z.input<typeof AuthSchema>,
): Promise<Result> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const d = AuthSchema.parse(input);
    await revokeAuthorization(supabase, clinicId, {
      ownerId: d.ownerId,
      channel: d.channel,
      invoiceId: d.invoiceId ?? null,
    });
    if (d.invoiceId) revalidatePath(`/dashboard/facturacion/${d.invoiceId}`);
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

const ResolveTaskSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(['RESUELTA', 'DESCARTADA']),
});

export async function resolveHumanTaskAction(
  input: z.input<typeof ResolveTaskSchema>,
): Promise<Result> {
  try {
    const { supabase, clinicId, userId } = await requireClinic();
    const d = ResolveTaskSchema.parse(input);
    await resolveHumanTask(supabase, clinicId, d.taskId, d.status, userId);
    revalidatePath('/dashboard/facturacion/cartera');
    return { ok: true };
  } catch (e) {
    return toError(e);
  }
}

/** Barrido manual desde el panel ("Ejecutar seguimiento ahora"). */
export async function runSweepNowAction(): Promise<
  Result<{ planned: number; sent: number; rescheduled: number; skipped: number }>
> {
  try {
    const { supabase, clinicId } = await requireClinic();
    const settings = await getBillingSettings(supabase, clinicId);
    if (!settings) return { ok: false, error: 'Módulo de facturación no configurado' };
    const r = await runCarteraSweepForClinic(supabase, clinicId, settings, new Date());
    const sent = r.dispatched.filter((d) => d.action === 'ENVIADO').length;
    const rescheduled = r.dispatched.filter((d) => d.action === 'REPROGRAMADO').length;
    const skipped = r.dispatched.filter((d) => d.action === 'OMITIDO' || d.action === 'SALTADO').length;
    revalidatePath('/dashboard/facturacion/cartera');
    revalidatePath('/dashboard/facturacion');
    return { ok: true, planned: r.plan.remindersCreated, sent, rescheduled, skipped };
  } catch (e) {
    return toError(e);
  }
}

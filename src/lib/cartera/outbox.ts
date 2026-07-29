// Outbox idempotente de cartera: toda comunicación saliente se registra en
// comm_messages con una idempotency_key estable. Reintentos técnicos con la
// misma clave NO producen mensajes duplicados (§9). Devuelve si ya existía.
//
// El caller puede ser la sesión (RLS) o el cron con service_role — por eso el
// clinic_id va SIEMPRE explícito en cada query (regla dura del contrato).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommMessageRow, CommsChannel } from '@/lib/supabase/types';
import { toYMD } from '@/lib/facturacion/domain/holidays';

export interface OutboxEntry {
  invoiceId: string | null;
  ownerId: string | null;
  channel: CommsChannel;
  to: string;
  template: string;
  body: string;
  authorizationId?: string | null;
  ruleSnapshot?: Record<string, unknown>;
}

/** Clave estable por (factura, paso, día): reintentos no duplican envíos. */
export function reminderIdempotencyKey(invoiceId: string, stepKind: string, when: Date): string {
  return `rem:${invoiceId}:${stepKind}:${toYMD(when)}`;
}

export interface OutboxResult {
  commId: string;
  alreadyExisted: boolean;
  row: CommMessageRow | null;
}

/**
 * Inserta (o recupera) la entrada del outbox de forma idempotente. La entrada
 * nace EN_COLA; el despachador la marca ENVIADO/ENTREGADO/FALLIDO tras el envío.
 */
export async function enqueueOutbound(
  supabase: SupabaseClient,
  clinicId: string,
  idempotencyKey: string,
  entry: OutboxEntry,
): Promise<OutboxResult> {
  const { data, error } = await supabase
    .from('comm_messages')
    .insert({
      clinic_id: clinicId,
      invoice_id: entry.invoiceId,
      owner_id: entry.ownerId,
      channel: entry.channel,
      direction: 'SALIENTE',
      to_address: entry.to,
      template: entry.template,
      body: entry.body,
      status: 'EN_COLA',
      authorization_id: entry.authorizationId ?? null,
      idempotency_key: idempotencyKey,
      rule_snapshot: entry.ruleSnapshot ?? null,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      // Ya existe una entrada con esa clave: recuperarla (idempotencia).
      const { data: existing } = await supabase
        .from('comm_messages')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (existing) {
        return {
          commId: (existing as CommMessageRow).id,
          alreadyExisted: true,
          row: existing as CommMessageRow,
        };
      }
    }
    throw new Error(`No se pudo encolar el mensaje: ${error.message}`);
  }
  return { commId: (data as CommMessageRow).id, alreadyExisted: false, row: data as CommMessageRow };
}

export async function markOutboxSent(
  supabase: SupabaseClient,
  clinicId: string,
  commId: string,
  result: {
    status: 'ENVIADO' | 'ENTREGADO' | 'FALLIDO';
    provider: string;
    providerMessageId: string | null;
    error?: string;
  },
  now: Date,
): Promise<void> {
  await supabase
    .from('comm_messages')
    .update({
      status: result.status,
      provider: result.provider,
      provider_message_id: result.providerMessageId,
      error: result.error ?? null,
      sent_at: result.status === 'FALLIDO' ? null : now.toISOString(),
      retry_count: result.status === 'FALLIDO' ? 1 : 0,
    })
    .eq('clinic_id', clinicId)
    .eq('id', commId);
}

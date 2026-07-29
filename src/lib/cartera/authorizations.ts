// Autorizaciones de canal del cliente (Ley 2300: solo canales autorizados).
// Vigente = granted && revoked_at is null. Revocar es idempotente.
// La tabla del destino es un superset (owner_id y payer_id nullables); el
// motor de cartera trabaja por owner_id, igual que el cliente.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelAuthorizationRow, CommsChannel } from '@/lib/supabase/types';

/** Canales con autorización vigente del responsable de pago (por su owner). */
export async function getAuthorizedChannels(
  supabase: SupabaseClient,
  clinicId: string,
  ownerId: string,
): Promise<CommsChannel[]> {
  const { data, error } = await supabase
    .from('channel_authorizations')
    .select('channel')
    .eq('clinic_id', clinicId)
    .eq('owner_id', ownerId)
    .eq('granted', true)
    .is('revoked_at', null);
  if (error) throw new Error(`No se pudieron leer autorizaciones: ${error.message}`);
  return (data ?? []).map((r) => (r as { channel: CommsChannel }).channel);
}

export async function grantAuthorization(
  supabase: SupabaseClient,
  clinicId: string,
  args: { ownerId: string; channel: CommsChannel; source?: string; createdBy?: string | null },
): Promise<void> {
  // Si ya hay una vigente, no duplicar (índice único parcial lo respalda).
  const { data: existing } = await supabase
    .from('channel_authorizations')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('owner_id', args.ownerId)
    .eq('channel', args.channel)
    .is('revoked_at', null)
    .maybeSingle();
  if (existing) return;

  const { error } = await supabase.from('channel_authorizations').insert({
    clinic_id: clinicId,
    created_by: args.createdBy ?? null,
    owner_id: args.ownerId,
    channel: args.channel,
    granted: true,
    source: args.source ?? null,
  });
  if (error && error.code !== '23505') {
    throw new Error(`No se pudo registrar la autorización: ${error.message}`);
  }
}

/** Revoca el canal (respuesta "no me escriban más" o baja manual). */
export async function revokeAuthorization(
  supabase: SupabaseClient,
  clinicId: string,
  args: { ownerId: string; channel: CommsChannel; invoiceId?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('channel_authorizations')
    .update({ granted: false, revoked_at: new Date().toISOString() })
    .eq('clinic_id', clinicId)
    .eq('owner_id', args.ownerId)
    .eq('channel', args.channel)
    .is('revoked_at', null);
  if (error) throw new Error(`No se pudo revocar la autorización: ${error.message}`);
  if (args.invoiceId) {
    await supabase.from('invoice_events').insert({
      invoice_id: args.invoiceId,
      event_type: 'CHANNEL_REVOKED',
      payload: { channel: args.channel },
    });
  }
}

export async function listAuthorizations(
  supabase: SupabaseClient,
  clinicId: string,
  ownerId: string,
): Promise<ChannelAuthorizationRow[]> {
  const { data, error } = await supabase
    .from('channel_authorizations')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`No se pudieron leer autorizaciones: ${error.message}`);
  return (data ?? []) as ChannelAuthorizationRow[];
}

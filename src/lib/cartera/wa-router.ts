import 'server-only';

// Router de contexto para WhatsApp (§B13): decide si un mensaje entrante va al
// agente de CARTERA en vez del agente general. Regla: hay una conversación de
// cobranza en curso — existe un saliente de cartera reciente por WhatsApp a este
// dueño Y la factura de ese saliente sigue con saldo y seguimiento activo. Así
// el agente de cartera solo entra cuando el cliente responde a un cobro, sin
// secuestrar los chats de citas.
//
// Si maneja el mensaje devuelve { handled: true } y el webhook NO debe correr
// el agente general (evita respuesta duplicada — riesgo del doble agente).
//
// Adaptación al destino: no hay wa_conversations/wa_messages — los entrantes
// viven en whatsapp_messages (esquema Meta-nativo + failed_at/error_detail) y
// el titular se resuelve por teléfono contra owners. El orquestador cablea
// esta función al webhook (este módulo NO toca el webhook). Firma del
// contrato: applyCarteraInbound(clinicId, fromPhone, text, waMessageId).

import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppText } from '@/lib/whatsapp/send-message';
import { bogotaTodayISO } from '@/lib/date-utils';
import { phonesMatch } from '@/lib/phone';
import { classifyCarteraIntent, executeCarteraInbound } from './inbound';
import { storeReceiptReference } from './receipts';

const LOOKBACK_MS = 30 * 24 * 3600 * 1000; // ventana de "cobranza en curso"

/**
 * Enruta un mensaje entrante de WhatsApp al agente de cartera si corresponde.
 *
 * @param clinicId    Clínica dueña del número (tenancy — service_role SIEMPRE
 *                    con clinic_id explícito, contrato §1).
 * @param fromPhone   Teléfono del remitente tal como llega del webhook.
 * @param text        Texto del mensaje (puede venir vacío si es solo adjunto).
 * @param waMessageId wa_message_id del entrante ya registrado en
 *                    whatsapp_messages (para leer media y auditar).
 */
export async function applyCarteraInbound(
  clinicId: string,
  fromPhone: string,
  text: string,
  waMessageId: string,
): Promise<{ handled: boolean }> {
  const admin = createAdminClient();

  // Respetar takeover/pausa del agente: si la clínica no está en modo auto,
  // el vet maneja el chat a mano (mismo gate que el modo auto general).
  const { data: integ } = await admin
    .from('whatsapp_integrations')
    .select('status, agent_mode')
    .eq('clinic_id', clinicId)
    .maybeSingle<{ status: string; agent_mode: string }>();
  if (!integ || integ.status !== 'connected' || integ.agent_mode !== 'auto') {
    return { handled: false };
  }

  // Titular por teléfono: candidato por últimos 10 dígitos + verificación
  // canónica (owners.phone es texto libre del CRM).
  const last10 = fromPhone.replace(/\D/g, '').slice(-10);
  if (!last10) return { handled: false };
  const { data: ownerRows } = await admin
    .from('owners')
    .select('id, phone')
    .eq('clinic_id', clinicId)
    .ilike('phone', `%${last10}%`)
    .limit(5);
  const owner =
    ((ownerRows as { id: string; phone: string | null }[] | null) ?? []).find((o) =>
      phonesMatch(o.phone, fromPhone),
    ) ?? null;
  if (!owner) return { handled: false };

  // ¿Cobranza en curso? Último saliente de cartera por WhatsApp a este dueño.
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data: lastOut } = await admin
    .from('comm_messages')
    .select('invoice_id, created_at')
    .eq('clinic_id', clinicId)
    .eq('owner_id', owner.id)
    .eq('channel', 'WHATSAPP')
    .eq('direction', 'SALIENTE')
    .not('invoice_id', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ invoice_id: string | null; created_at: string }>();
  if (!lastOut?.invoice_id) return { handled: false };

  // La factura debe seguir cobrable.
  const { data: inv } = await admin
    .from('invoices')
    .select('id, full_number, share_token, balance_cents, status, followup_enabled')
    .eq('clinic_id', clinicId)
    .eq('id', lastOut.invoice_id)
    .maybeSingle<{
      id: string;
      full_number: string | null;
      share_token: string;
      balance_cents: number;
      status: string;
      followup_enabled: boolean;
    }>();
  if (!inv || inv.status !== 'EMITIDA' || inv.balance_cents <= 0 || !inv.followup_enabled) {
    return { handled: false };
  }

  // Media del mensaje disparador (comprobantes adjuntos), desde el registro
  // que el webhook ya dejó en whatsapp_messages.
  const { data: msg } = await admin
    .from('whatsapp_messages')
    .select('media_url, media_type')
    .eq('clinic_id', clinicId)
    .eq('wa_message_id', waMessageId)
    .maybeSingle<{ media_url: string | null; media_type: string | null }>();
  const trimmed = text.trim();
  // Se detecta por `media_type`, no por `media_url`: el tipo lo escribe el webhook en el mismo
  // insert, mientras que la ruta la escribe la descarga posterior. Mirando sólo la ruta —que es lo
  // que se hacía— una foto cuya descarga falló dejaba de contar como adjunto y el titular que mandó
  // el comprobante no recibía nada. (Y antes de la 0056 la ruta no se escribía NUNCA, así que este
  // camino entero estaba muerto.)
  const hasMedia = !!msg?.media_type || !!msg?.media_url;
  if (!trimmed && !hasMedia) return { handled: false };

  const classification = await classifyCarteraIntent(
    trimmed || '(el cliente envió un archivo adjunto, probablemente un comprobante)',
    { todayISO: bogotaTodayISO(), clinicId },
  );

  const result = await executeCarteraInbound(admin, clinicId, {
    channel: 'WHATSAPP',
    ownerId: owner.id,
    invoiceId: inv.id,
    invoiceNumber: inv.full_number ?? '',
    shareToken: inv.share_token,
    incomingText: trimmed || '[adjunto]',
    classification,
    waConversationId: null, // el destino no maneja conversaciones como entidad
  });

  // Adjunto → comprobante (referencia a la media + tarea de verificación).
  if (hasMedia && msg?.media_url) {
    await storeReceiptReference(admin, clinicId, {
      invoiceId: inv.id,
      invoiceNumber: inv.full_number ?? '',
      ownerId: owner.id,
      commMessageId: result.commMessageId,
      url: msg.media_url,
      contentType: msg.media_type ?? null,
    });
  }

  // Responder por WhatsApp (ventana de 24h abierta: el cliente acaba de
  // escribir). sendWhatsAppText registra el saliente en whatsapp_messages.
  if (result.reply) {
    try {
      await sendWhatsAppText(clinicId, fromPhone, result.reply, {
        ownerId: owner.id,
        sentBy: null,
        agentMode: 'auto',
        origen: 'athos',
      });
    } catch (e) {
      console.error('[cartera/wa-router] no se pudo responder:', e);
    }
  }

  return { handled: true };
}

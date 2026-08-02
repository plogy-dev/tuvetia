// Envío de una factura EMITIDA al cliente por correo.
//
// Deja de ser un stub: la clínica configura SMTP (App Password de Gmail) en Configuración y desde
// acá sale el correo con el enlace público /f/<share_token>. El motivo por el que es SMTP y no la
// API de Gmail está en el encabezado de la migración 0039 — resumen: leer el buzón por API exige un
// scope RESTRINGIDO de Google (auditoría CASA, meses), y las App Passwords están exceptuadas.
//
// El Message-ID del correo se guarda en invoice_email_threads: es la raíz del hilo, y lo que le
// permite al cron de cartera reconocer la respuesta del cliente y atribuirla a esta factura.

import type { SupabaseClient } from '@supabase/supabase-js';

import { getAppBaseUrl } from '@/lib/base-url';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildMessageId } from '@/lib/email/threading';
import { loadClinicSender, sendTransactionalEmail, transactionalFrom } from '@/lib/email/transactional';
import { markInvoiceSent } from './invoices';

export interface SendInvoiceEmailInput {
  invoiceId: string;
  /** Email destino; por defecto el del pagador. */
  to?: string | null;
  /** Mensaje breve que antecede el enlace. */
  message?: string | null;
}

export type SendInvoiceEmailResult =
  | { ok: true; to: string; fullNumber: string; publicUrl: string }
  | {
      ok: false;
      reason: 'sin_destinatario' | 'factura_no_encontrada' | 'envio_fallido';
      error?: string;
    };

export async function sendInvoiceByEmail(
  supabase: SupabaseClient,
  clinicId: string,
  input: SendInvoiceEmailInput,
): Promise<SendInvoiceEmailResult> {
  // 1) La factura, con la SESIÓN del vet: si no es de su clínica, la RLS la esconde y no existe.
  const { data: invRow } = await supabase
    .from('invoices')
    .select('id, full_number, number, share_token, payer_id, balance_cents, total_cents')
    .eq('id', input.invoiceId)
    .maybeSingle();
  const invoice = invRow as {
    id: string;
    full_number: string | null;
    number: string | null;
    share_token: string;
    payer_id: string | null;
    balance_cents: number;
    total_cents: number;
  } | null;
  if (!invoice) return { ok: false, reason: 'factura_no_encontrada' };

  // 2) Destinatario: el explícito gana; si no, el del pagador.
  let to = input.to?.trim() ?? '';
  if (!to && invoice.payer_id) {
    const { data: payer } = await supabase
      .from('billing_payers')
      .select('email')
      .eq('clinic_id', clinicId)
      .eq('id', invoice.payer_id)
      .maybeSingle();
    to = ((payer as { email: string | null } | null)?.email ?? '').trim();
  }
  if (!to) return { ok: false, reason: 'sin_destinatario' };

  // 3) Quién firma: nombre de la clínica + Reply-To a sus administradores. El correo sale de
  //    vet@tuvetia.com — ya no hace falta que la clínica configure SMTP para poder facturar.
  //    Ver CORREOS.md.
  const sender = await loadClinicSender(clinicId);

  const fullNumber = invoice.full_number ?? invoice.number ?? '';
  const publicUrl = `${getAppBaseUrl()}/f/${invoice.share_token}`;
  const subject = fullNumber ? `Factura ${fullNumber}` : 'Su factura';

  // Message-ID propio: raíz del hilo. `unique` con el reloj permite reenviar la misma factura sin
  // repetir el id — el RFC lo exige y hay servidores que rechazan el duplicado.
  const messageId = buildMessageId(invoice.id, transactionalFrom(), String(Date.now()));

  const saludo = input.message?.trim();
  const text = [
    saludo || 'Le compartimos su factura.',
    '',
    fullNumber ? `Factura: ${fullNumber}` : '',
    `Puede verla y pagarla acá: ${publicUrl}`,
    '',
    'Si tiene alguna duda, puede responder a este correo.',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await sendTransactionalEmail(clinicId, { to, subject, text, messageId }, sender);

  if (!result.ok) {
    // Ya no se marca `email_integrations` en error: el fallo es de Resend o del dominio de Tuvetia,
    // no de la credencial de la clínica — culparla ahí mandaría al vet a arreglar lo que no está roto.
    return { ok: false, reason: 'envio_fallido', error: result.error };
  }

  // 4) Hilo: se guarda ANTES de marcar enviada, porque sin la raíz del hilo la respuesta del cliente
  //    no se puede atribuir a esta factura. Con admin: la columna vive fuera del alcance de la RLS
  //    del vet y el clinic_id va explícito.
  const admin = createAdminClient();
  const { error: threadErr } = await admin.from('invoice_email_threads').upsert(
    {
      clinic_id: clinicId,
      invoice_id: invoice.id,
      root_message_id: messageId,
      subject,
      to_email: to,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'clinic_id,invoice_id' },
  );
  // No se aborta: el correo YA salió. Se registra para no perder la traza del problema.
  if (threadErr) {
    console.error('[facturacion/email] no se pudo guardar el hilo:', threadErr.message);
  }

  await markInvoiceSent(supabase, clinicId, invoice.id, { channel: 'EMAIL', to });

  return { ok: true, to, fullNumber, publicUrl };
}

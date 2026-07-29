// Envío de una factura EMITIDA al cliente por email.
//
// STUB (contrato §5): el destino NO tiene email configurado (nada de
// Gmail/nodemailer). Se conserva la interfaz del cliente para que los callers
// (server action del botón "Enviar", futuras tools) compilen sin cambios de
// forma; la implementación siempre devuelve { ok: false, reason:
// "email_no_configurado" } y quien llama decide cómo mostrarlo. Cuando exista
// un proveedor de correo, este módulo recupera la implementación real
// (enlace público /f/[share_token] + registro + markInvoiceSent).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SendInvoiceEmailInput {
  invoiceId: string;
  /** Email destino; por defecto el del pagador. */
  to?: string | null;
  /** Mensaje breve que antecede el enlace. */
  message?: string | null;
}

export type SendInvoiceEmailResult =
  | { ok: true; to: string; fullNumber: string; publicUrl: string }
  | { ok: false; reason: 'email_no_configurado' };

export async function sendInvoiceByEmail(
  _supabase: SupabaseClient,
  _clinicId: string,
  _input: SendInvoiceEmailInput,
): Promise<SendInvoiceEmailResult> {
  console.log('[facturacion/email] envío omitido: email_no_configurado');
  return { ok: false, reason: 'email_no_configurado' };
}

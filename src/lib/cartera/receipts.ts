import 'server-only';

// Comprobantes de pago recibidos por el canal entrante. Se guardan en el bucket
// PRIVADO `receipts` (policies por clinic path: <clinic_id>/…, contrato §4)
// + una fila en receipt_attachments, y se abre una tarea VERIFICAR_COMPROBANTE
// para que una persona concilie. El agente NUNCA da por pagado: solo recibe y
// escala.

import type { SupabaseClient } from '@supabase/supabase-js';
import { humanTaskTitle } from './intents';
import { openHumanTask } from './tasks';

const BUCKET = 'receipts';

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'comprobante';
}

/**
 * Sube un comprobante (bytes) al bucket privado, lo registra y abre la tarea de
 * verificación. Idempotencia de la tarea: una abierta por (factura, tipo).
 */
export async function storeReceipt(
  supabase: SupabaseClient,
  clinicId: string,
  args: {
    invoiceId: string;
    invoiceNumber: string;
    ownerId: string | null;
    commMessageId: string | null;
    filename: string;
    contentType: string | null;
    bytes: Buffer;
    now?: Date;
  },
): Promise<{ filePath: string }> {
  const stamp = (args.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const filePath = `${clinicId}/${args.invoiceId}/${stamp}-${safeName(args.filename)}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(filePath, args.bytes, {
    contentType: args.contentType ?? 'application/octet-stream',
    upsert: false,
  });
  if (upErr) throw new Error(`No se pudo subir el comprobante: ${upErr.message}`);

  await supabase.from('receipt_attachments').insert({
    clinic_id: clinicId,
    invoice_id: args.invoiceId,
    comm_message_id: args.commMessageId,
    file_path: filePath,
    content_type: args.contentType ?? null,
  });

  await openHumanTask(supabase, clinicId, {
    kind: 'VERIFICAR_COMPROBANTE',
    invoiceId: args.invoiceId,
    ownerId: args.ownerId,
    title: humanTaskTitle('VERIFICAR_COMPROBANTE', args.invoiceNumber),
    payload: { filePath, source: 'ADJUNTO' },
  });

  return { filePath };
}

/**
 * Registra un comprobante que llegó como media de WhatsApp. Desde la 0056 lo que
 * se recibe acá NO es una URL externa: es la ruta dentro del bucket privado
 * `whatsapp-media`, porque el webhook ya bajó los bytes (la media del proveedor
 * es efímera en Meta y en Baileys, así que referenciarla no servía — y de hecho
 * `media_url` no se escribía nunca, con lo cual este camino jamás se ejecutó).
 *
 * OJO al leerlo: `file_path` apunta a `whatsapp-media`, no a `receipts` como el
 * de `storeReceipt`. Lo que los distingue es el `source` de la tarea
 * (`WHATSAPP_MEDIA` vs `ADJUNTO`). Hoy nadie lee esta tabla todavía.
 */
export async function storeReceiptReference(
  supabase: SupabaseClient,
  clinicId: string,
  args: {
    invoiceId: string;
    invoiceNumber: string;
    ownerId: string | null;
    commMessageId: string | null;
    url: string;
    contentType: string | null;
  },
): Promise<void> {
  await supabase.from('receipt_attachments').insert({
    clinic_id: clinicId,
    invoice_id: args.invoiceId,
    comm_message_id: args.commMessageId,
    file_path: args.url, // referencia externa (media del proveedor de WhatsApp)
    content_type: args.contentType ?? null,
  });

  await openHumanTask(supabase, clinicId, {
    kind: 'VERIFICAR_COMPROBANTE',
    invoiceId: args.invoiceId,
    ownerId: args.ownerId,
    title: humanTaskTitle('VERIFICAR_COMPROBANTE', args.invoiceNumber),
    payload: { url: args.url, source: 'WHATSAPP_MEDIA' },
  });
}

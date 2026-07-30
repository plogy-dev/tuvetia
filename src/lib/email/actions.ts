'use server';

// Server actions de la conexión de correo (Configuración → Correo).
// Mismo patrón que el resto del repo: validar sesión → validar input con Zod → operar → Result.
//
// El flujo de conexión VERIFICA ANTES de marcar conectado: se arma el objeto de credenciales en
// memoria, se hace el handshake SMTP real, y solo si pasa se guarda como 'connected'. Si falla, se
// guarda como 'error' con el motivo — así Configuración muestra algo accionable y el vet no cree
// que el correo anda cuando no anda. Nunca existe una integración 'connected' sin handshake.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import {
  getEmailIntegration,
  markConnected,
  markError,
  saveEmailIntegration,
  type EmailCredentials,
} from './integrations';
import { verifySmtp } from './smtp';

export type EmailActionState = { ok: true } | { ok: false; error: string } | null;

/** Sesión + clínica, igual que requireClinic de facturación. */
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
  return { clinicId, userId: user.id };
}

const ConnectSchema = z.object({
  from_email: z.string().trim().toLowerCase().email('Escribí un correo válido'),
  from_name: z.string().trim().max(120).optional(),
  // La App Password de Google son 16 letras que la UI muestra en grupos de 4; se aceptan los
  // espacios y se quitan acá — pegarla "con espacios" es el tropiezo más común de este flujo.
  credential: z
    .string()
    .transform((s) => s.replace(/\s+/g, ''))
    .pipe(z.string().min(8, 'La contraseña de aplicación parece incompleta')),
});

export async function connectEmailAction(
  _prev: EmailActionState,
  formData: FormData,
): Promise<EmailActionState> {
  try {
    const { clinicId, userId } = await requireClinic();
    const parsed = ConnectSchema.safeParse({
      from_email: formData.get('from_email'),
      from_name: formData.get('from_name') || undefined,
      credential: formData.get('credential'),
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }
    const d = parsed.data;

    // 1) Handshake ANTES de persistir nada como conectado. Credenciales en memoria, defaults de
    //    Gmail (los mismos de la migración 0039).
    const trial: EmailCredentials = {
      id: '',
      clinic_id: clinicId,
      provider: 'smtp',
      from_email: d.from_email,
      from_name: d.from_name ?? null,
      smtp_host: 'smtp.gmail.com',
      smtp_port: 465,
      smtp_secure: true,
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      imap_mailbox: 'INBOX',
      status: 'pending',
      last_error: null,
      verified_at: null,
      connected_at: null,
      credential: d.credential,
    };
    const check = await verifySmtp(trial);

    // 2) Se guarda SIEMPRE (cifrada): si falló, en 'error' con el motivo — el vet corrige la
    //    contraseña sin re-tipear todo; si pasó, 'connected'.
    await saveEmailIntegration({
      clinicId,
      userId,
      fromEmail: d.from_email,
      fromName: d.from_name ?? null,
      credential: d.credential,
    });
    if (!check.ok) {
      await markError(
        clinicId,
        smtpErrorHelp(check.error ?? 'El servidor de correo rechazó la conexión.'),
      );
      revalidatePath('/dashboard/settings');
      return { ok: false, error: smtpErrorHelp(check.error ?? 'No se pudo conectar.') };
    }
    await markConnected(clinicId);
    revalidatePath('/dashboard/settings');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error inesperado' };
  }
}

export async function disconnectEmailAction(): Promise<EmailActionState> {
  try {
    const { clinicId } = await requireClinic();
    const existing = await getEmailIntegration(clinicId);
    if (!existing) return { ok: true };
    // Se borra la CREDENCIAL, no la fila: el from_email y los hilos quedan, y reconectar es solo
    // volver a pegar la contraseña.
    const { createAdminClient } = await import('@/lib/supabase/admin');
    await createAdminClient()
      .from('email_integrations')
      .update({
        status: 'disconnected',
        credential_enc: null,
        updated_at: new Date().toISOString(),
      })
      .eq('clinic_id', clinicId);
    revalidatePath('/dashboard/settings');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error inesperado' };
  }
}

/**
 * Traduce los fallos típicos de Gmail a una acción concreta. El error crudo de SMTP ("535-5.7.8
 * Username and Password not accepted") no le dice al vet QUÉ hacer.
 */
function smtpErrorHelp(raw: string): string {
  if (/535|EAUTH|not accepted|BadCredentials/i.test(raw)) {
    return 'Gmail rechazó la contraseña. Verificá que sea una CONTRASEÑA DE APLICACIÓN (no la de tu cuenta) y que la verificación en dos pasos esté activa.';
  }
  if (/ETIMEDOUT|ECONNECTION|ECONNREFUSED|ENOTFOUND/i.test(raw)) {
    return 'No se pudo alcanzar el servidor de correo. Reintentá en un momento.';
  }
  return raw;
}

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { BillingSettingsRow } from '@/lib/supabase/types';
import { runCarteraSweepForClinic } from './scheduler';

/**
 * Barrido de cartera a nivel sistema: recorre las clínicas con recordatorios
 * activos y ejecuta el motor para cada una. Lo llama el cron. Usa el admin
 * client (sin cookie) filtrando SIEMPRE por clinic_id — el aislamiento lo da
 * la consulta explícita, no la RLS (service-role la salta). Regla dura del
 * contrato §1.
 *
 * (La reconciliación de reauth de Gmail del cliente se OMITIÓ: el destino no
 * tiene email; el canal WhatsApp reporta su estado vía whatsapp_integrations
 * y el despachador ya reprograma los envíos transitorios.)
 */
export async function runCarteraForAllClinics(now = new Date()): Promise<{
  clinics: number;
  remindersCreated: number;
  sent: number;
  rescheduled: number;
  skipped: number;
}> {
  const admin = createAdminClient();
  const { data: settingsRows } = await admin
    .from('billing_settings')
    .select('*')
    .eq('reminders_enabled', true)
    .eq('module_status', 'ACTIVO')
    .returns<BillingSettingsRow[]>();

  let remindersCreated = 0;
  let sent = 0;
  let rescheduled = 0;
  let skipped = 0;

  for (const settings of settingsRows ?? []) {
    try {
      const r = await runCarteraSweepForClinic(admin, settings.clinic_id, settings, now);
      remindersCreated += r.plan.remindersCreated;
      sent += r.dispatched.filter((d) => d.action === 'ENVIADO').length;
      rescheduled += r.dispatched.filter((d) => d.action === 'REPROGRAMADO').length;
      skipped += r.dispatched.filter((d) => d.action === 'OMITIDO' || d.action === 'SALTADO').length;
    } catch {
      // Una clínica que falle no debe frenar a las demás.
    }
  }

  return { clinics: settingsRows?.length ?? 0, remindersCreated, sent, rescheduled, skipped };
}

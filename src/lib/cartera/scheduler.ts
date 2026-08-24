// Motor de cartera: dos barridos idempotentes que corren desde el cron.
//
//  1. PROGRAMADOR (planNext): facturas con saldo y seguimiento activo sin pasos
//     futuros → genera invoice_reminders desde la política. Promesas vencidas →
//     evento PROMISE_EXPIRED + refresh (el recaudo revierte a VENCIDA/PENDIENTE).
//
//  2. DESPACHADOR (dispatchDue): recordatorios PENDIENTE vencidos → gate Ley 2300
//     (dominio puro) → selección de canal → envío por el puerto → outbox → estado.
//     Denegaciones: fuera de horario → siguiente ventana; ya contactado hoy /
//     multicanal → siguiente día hábil; sin canal → OMITIDO + tarea humana.
//
// Todas las DECISIONES viven en el dominio (canContact, selectChannel,
// nextAllowedTime, scheduleReminders); aquí solo va la orquestación sobre la BD.
// Los LÍMITES de la Ley 2300 (ventanas horarias, 1 contacto/día, festivos,
// multicanal) se preservan INTACTOS — son la joya del módulo (contrato §5).
//
// Port: el texto del recordatorio se redacta DIRECTO (STEP_TEMPLATES) y sale
// por sendWhatsAppText vía el puerto — sin plantillas Meta. El canal EMAIL no
// está configurado: nunca figura conectado y el barrido lo salta con log.

// PRIMERO: ancla el proceso a America/Bogota. El dominio evalúa las ventanas de la Ley 2300 con
// los getters locales de Date, y en Vercel el runtime es UTC — sin esto la ventana queda corrida
// 5 horas (permitiría cobrar de madrugada). Ver business-timezone.ts.
import { assertBusinessTimezone } from './business-timezone';

import type { SupabaseClient } from '@supabase/supabase-js';
import { holidaySet } from '@/lib/facturacion/domain/holidays';
import {
  canContact,
  isSameWeek,
  nextAllowedTime,
  scheduleReminders,
  selectChannel,
} from '@/lib/facturacion/domain/reminders';
import type { Channel, ReminderStepKind } from '@/lib/facturacion/domain/types';
import type {
  BillingSettingsRow,
  CommsChannel,
  InvoiceReminderRow,
  InvoiceRow,
} from '@/lib/supabase/types';
import { refreshInvoiceStatus } from '@/lib/facturacion/invoices';
import { getAppBaseUrl } from '@/lib/base-url';
import { getAuthorizedChannels } from './authorizations';
import { getMessagingPort } from './channels';
import type { MessagingPort } from './messaging';
import { resolvePolicySteps } from './policy';
import { leerPlantillas, llenarPlantilla, plantillaDe } from './plantillas';
import { enqueueOutbound, markOutboxSent, reminderIdempotencyKey } from './outbox';
import { openHumanTask } from './tasks';

// EL TEXTO YA NO VIVE ACÁ. Estaba escrito a mano en este archivo, así que todas las clínicas del
// país mandaban el mismo mensaje. Ahora sale de `lib/cartera/plantillas.ts`: el de la clínica si lo
// escribió, y si no el de por defecto — que es palabra por palabra el que estaba acá.

/** Asunto por paso (reservado para cuando exista canal de email). */
const STEP_SUBJECTS: Record<ReminderStepKind, string> = {
  ENVIO_FACTURA: 'Su factura {number}',
  RECORDATORIO_1: 'Recordatorio de pago — factura {number}',
  RECORDATORIO_2: 'Segundo recordatorio — factura {number}',
  AVISO_SALDO: 'Aviso de saldo pendiente — factura {number}',
  ESCALAMIENTO: 'Saldo pendiente — factura {number}',
};

function bogotaHolidays(now: Date): Set<string> {
  const y = now.getFullYear();
  return holidaySet([y - 1, y, y + 1]);
}

function fmtCOP(cents: number): string {
  return `$ ${Math.round(cents / 100).toLocaleString('es-CO')}`;
}

// ─── Programador ─────────────────────────────────────────────────────────────

export interface PlanResult {
  invoicesPlanned: number;
  remindersCreated: number;
  promisesExpired: number;
}

export async function planNextReminders(
  supabase: SupabaseClient,
  clinicId: string,
  settings: BillingSettingsRow,
  now = new Date(),
): Promise<PlanResult> {
  const result: PlanResult = { invoicesPlanned: 0, remindersCreated: 0, promisesExpired: 0 };

  // Facturas emitidas con saldo, seguimiento activo y no pausadas.
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, due_date, balance_cents, collection_status, reminders_paused, followup_enabled')
    .eq('clinic_id', clinicId)
    .eq('status', 'EMITIDA')
    .eq('followup_enabled', true)
    .gt('balance_cents', 0);
  if (error) throw new Error(`No se pudieron leer facturas: ${error.message}`);

  const steps = resolvePolicySteps(settings.reminder_policy);

  for (const inv of (invoices ?? []) as Pick<
    InvoiceRow,
    'id' | 'due_date' | 'balance_cents' | 'collection_status' | 'reminders_paused' | 'followup_enabled'
  >[]) {
    // Promesa vencida: refrescar (deriveStatus la revierte) y registrar el hito.
    if (inv.collection_status === 'EN_PROMESA_DE_PAGO') {
      const derived = await refreshInvoiceStatus(supabase, clinicId, inv.id, now);
      if (derived.collection !== 'EN_PROMESA_DE_PAGO') {
        await supabase
          .from('invoice_events')
          .insert({ invoice_id: inv.id, event_type: 'PROMISE_EXPIRED', payload: {} });
        result.promisesExpired += 1;
      } else {
        continue; // promesa aún vigente → no programar
      }
    }
    if (inv.reminders_paused) continue;
    if (!inv.due_date) continue;

    // ¿Ya tiene pasos PENDIENTE por delante? Si sí, no reprogramar.
    const { count } = await supabase
      .from('invoice_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('invoice_id', inv.id)
      .eq('status', 'PENDIENTE');
    if ((count ?? 0) > 0) continue;

    // ¿Ya se ejecutó toda la política? (evita re-generar tras completarse)
    const { count: total } = await supabase
      .from('invoice_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('invoice_id', inv.id);
    if ((total ?? 0) >= steps.length) continue;

    // `T09:00:00-05:00`, con el offset EXPLÍCITO. Sin él, Node parsea la fecha como hora local del
    // proceso — y en Vercel el proceso corre en UTC, así que las 09:00 pretendidas eran las 04:00
    // de Bogotá. Verificado: `TZ=UTC node -e "new Date('2026-08-20T09:00:00').toISOString()"` da
    // `2026-08-20T09:00:00.000Z`.
    //
    // El daño era acotado porque la ventana de la Ley 2300 (`domain/reminders.ts`) reprograma todo
    // lo que cae fuera de 7:00–19:00, así que no salía nada de madrugada: salían al ABRIR la
    // ventana en vez de a las nueve. Igual se corrige, porque es el mismo bug que este repo ya
    // arregló dos veces —`invoices.ts` con `finDelDiaBogota`, y todo `business-timezone.ts` existe
    // por esto— y acá había quedado uno suelto.
    //
    // El `-05:00` va literal y no calculado: Bogotá es UTC-5 fijo, sin horario de verano. Es el
    // mismo criterio que `inicioDelMesISO` en `athos-agent/presupuesto.ts`.
    const due = new Date(`${inv.due_date}T09:00:00-05:00`);
    const schedule = scheduleReminders(due, steps);
    const rows = schedule.map((s) => ({
      invoice_id: inv.id,
      step_kind: s.kind,
      scheduled_for: s.scheduledFor.toISOString(),
      status: 'PENDIENTE' as const,
    }));
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('invoice_reminders').insert(rows);
      if (insErr) throw new Error(`No se pudieron crear recordatorios: ${insErr.message}`);
      result.invoicesPlanned += 1;
      result.remindersCreated += rows.length;
    }
  }
  return result;
}

// ─── Despachador ─────────────────────────────────────────────────────────────

export interface DispatchOutcome {
  reminderId: string;
  invoiceId: string;
  action: 'ENVIADO' | 'REPROGRAMADO' | 'OMITIDO' | 'SALTADO';
  reason?: string;
  channel?: CommsChannel;
}

type DueReminder = Pick<InvoiceReminderRow, 'id' | 'step_kind' | 'invoice_id'>;

export async function dispatchDueReminders(
  supabase: SupabaseClient,
  clinicId: string,
  settings: BillingSettingsRow,
  now = new Date(),
  injectedPort?: MessagingPort,
): Promise<DispatchOutcome[]> {
  const holidays = bogotaHolidays(now);
  const port = injectedPort ?? getMessagingPort(clinicId);
  const connected = await port.connectedChannels();
  const preferred = (settings.reminder_channel ?? 'WHATSAPP') as Channel;
  // Se leen UNA vez por barrido, no por recordatorio: son las mismas para toda la clínica.
  const plantillas = leerPlantillas(settings.reminder_templates);
  if (preferred === 'EMAIL' && !connected.includes('EMAIL')) {
    console.log(
      `[cartera/scheduler] clinic=${clinicId} canal preferido EMAIL no configurado: se usa WhatsApp si está autorizado`,
    );
  }
  const outcomes: DispatchOutcome[] = [];

  // Recordatorios vencidos, en facturas con saldo y seguimiento no pausado.
  // El filtro por clínica va vía la factura (invoice_reminders no tiene
  // clinic_id directo): se valida invoice por invoice más abajo con clinic_id.
  const { data: due, error } = await supabase
    .from('invoice_reminders')
    .select('id, step_kind, invoice_id, invoice:invoices!inner(clinic_id)')
    .eq('invoice.clinic_id', clinicId)
    .eq('status', 'PENDIENTE')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(200);
  if (error) throw new Error(`No se pudieron leer recordatorios: ${error.message}`);

  for (const rem of (due ?? []) as unknown as DueReminder[]) {
    // Cargar la factura + pagador + owner (para autorizaciones y destino).
    const { data: inv } = await supabase
      .from('invoices')
      .select('id, full_number, number, balance_cents, reminders_paused, followup_enabled, payer_id, share_token')
      .eq('clinic_id', clinicId)
      .eq('id', rem.invoice_id)
      .maybeSingle();
    if (!inv) continue;
    const invoice = inv as Pick<
      InvoiceRow,
      'id' | 'full_number' | 'number' | 'balance_cents' | 'reminders_paused' | 'followup_enabled' | 'payer_id' | 'share_token'
    >;

    // Detención: pago total / pausa / opt-out cancelan el recordatorio.
    if (invoice.balance_cents <= 0 || invoice.reminders_paused || !invoice.followup_enabled) {
      await supabase
        .from('invoice_reminders')
        .update({ status: 'CANCELADO', skipped_reason: 'SEGUIMIENTO_DETENIDO' })
        .eq('id', rem.id);
      outcomes.push({ reminderId: rem.id, invoiceId: rem.invoice_id, action: 'SALTADO', reason: 'SEGUIMIENTO_DETENIDO' });
      continue;
    }

    const { data: payer } = await supabase
      .from('billing_payers')
      .select('id, name, email, phone, owner_id')
      .eq('clinic_id', clinicId)
      .eq('id', invoice.payer_id ?? '')
      .maybeSingle();
    const ownerId = (payer as { owner_id?: string | null } | null)?.owner_id ?? null;

    const authorized = ownerId ? await getAuthorizedChannels(supabase, clinicId, ownerId) : [];

    // Contactos de cobranza ya hechos HOY a este deudor (todas sus facturas,
    // ambos canales) — interpretación conservadora de "1 contacto/día" (§5).
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    let contactsToday = 0;
    if (ownerId) {
      const { count } = await supabase
        .from('comm_messages')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('owner_id', ownerId)
        .eq('direction', 'SALIENTE')
        .gte('sent_at', dayStart.toISOString())
        .lt('sent_at', dayEnd.toISOString());
      contactsToday = count ?? 0;
    }

    // Último contacto DIRECTO del deudor (respuesta entrante esta semana): tras
    // una respuesta directa no se cambia de canal en la misma semana (§5). Se lee
    // del outbox unificado (comm_messages ENTRANTE) que llena el router entrante.
    let lastDirectContact: { at: Date; channel: Channel } | null = null;
    if (ownerId) {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data: lastIn } = await supabase
        .from('comm_messages')
        .select('channel, created_at')
        .eq('clinic_id', clinicId)
        .eq('owner_id', ownerId)
        .eq('direction', 'ENTRANTE')
        .gte('created_at', weekAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ channel: CommsChannel; created_at: string }>();
      if (lastIn) {
        lastDirectContact = { at: new Date(lastIn.created_at), channel: lastIn.channel as Channel };
      }
    }
    const directChannelThisWeek =
      lastDirectContact && isSameWeek(lastDirectContact.at, now) ? lastDirectContact.channel : null;

    // Selección de canal (dominio puro).
    const selection = selectChannel({
      preferred,
      authorized: authorized as Channel[],
      connected: connected as Channel[],
      directContactChannelThisWeek: directChannelThisWeek,
    });
    if (selection.channel === null) {
      await supabase
        .from('invoice_reminders')
        .update({ status: 'OMITIDO', skipped_reason: 'SIN_CANAL_DISPONIBLE' })
        .eq('id', rem.id);
      if (ownerId) {
        await openHumanTask(supabase, clinicId, {
          kind: 'CONTACTO_SOLICITADO',
          invoiceId: invoice.id,
          ownerId,
          title: `Sin canal autorizado para cobrar ${invoice.full_number ?? ''}`.trim(),
          payload: { reason: 'SIN_CANAL_DISPONIBLE' },
        });
      }
      outcomes.push({ reminderId: rem.id, invoiceId: rem.invoice_id, action: 'OMITIDO', reason: 'SIN_CANAL_DISPONIBLE' });
      continue;
    }
    const channel = selection.channel;

    // Gate legal Ley 2300 (ventana, 1 contacto/día, multicanal, autorizado).
    const verdict = canContact(now, {
      holidays,
      authorizedChannels: authorized as Channel[],
      channel,
      contactsOnSameDay: contactsToday,
      lastDirectContact,
    });

    if (!verdict.allowed) {
      // Reprogramar (nunca contactar fuera de las reglas).
      const base = new Date(now);
      if (verdict.reason !== 'FUERA_DE_HORARIO') {
        base.setDate(base.getDate() + 1);
        base.setHours(7, 0, 0, 0);
      }
      const next = nextAllowedTime(base, holidays);
      await supabase
        .from('invoice_reminders')
        .update({ scheduled_for: next.toISOString() })
        .eq('id', rem.id);
      outcomes.push({
        reminderId: rem.id,
        invoiceId: rem.invoice_id,
        action: 'REPROGRAMADO',
        reason: verdict.reason,
        channel,
      });
      continue;
    }

    // Enviar: outbox idempotente → puerto → estado.
    const to =
      channel === 'EMAIL'
        ? ((payer as { email?: string | null } | null)?.email ?? '')
        : ((payer as { phone?: string | null } | null)?.phone ?? '');
    const stepKind = rem.step_kind as ReminderStepKind;
    const number = invoice.full_number ?? '';
    const balance = fmtCOP(invoice.balance_cents);
    const link = `${getAppBaseUrl()}/f/${invoice.share_token}`;
    // `llenarPlantilla` reemplaza TODAS las apariciones y trata el valor como texto plano. Lo de
    // acá era `.replace('{x}', valor)`, que cambia sólo la primera y además interpreta `$&` y `$1`
    // del valor como referencias de reemplazo — y el saldo colombiano SIEMPRE trae un `$`.
    const body = llenarPlantilla(plantillaDe(plantillas, stepKind), { number, balance, link });
    const subject = llenarPlantilla(STEP_SUBJECTS[stepKind], { number, balance, link });

    const key = reminderIdempotencyKey(invoice.id, rem.step_kind, now);
    const enq = await enqueueOutbound(supabase, clinicId, key, {
      invoiceId: invoice.id,
      ownerId,
      channel,
      to,
      template: rem.step_kind.toLowerCase(),
      body,
      ruleSnapshot: {
        rule: 'LEY_2300',
        window: 'OK',
        contactsToday,
        channel,
        fallback: selection.fallback,
        at: now.toISOString(),
      },
    });

    // Si ya existía (reintento), no reenviar: solo cerrar el recordatorio.
    if (enq.alreadyExisted && enq.row?.status && enq.row.status !== 'EN_COLA') {
      await supabase
        .from('invoice_reminders')
        .update({ status: 'ENVIADO', sent_comm_id: enq.commId })
        .eq('id', rem.id);
      outcomes.push({ reminderId: rem.id, invoiceId: rem.invoice_id, action: 'ENVIADO', channel });
      continue;
    }

    const send = await port.send({
      channel,
      to,
      template: rem.step_kind.toLowerCase(),
      body,
      invoiceId: invoice.id,
      ownerId,
      subject,
    });
    await markOutboxSent(
      supabase,
      clinicId,
      enq.commId,
      {
        status: send.status,
        provider: send.provider,
        providerMessageId: send.providerMessageId,
        error: send.error,
      },
      now,
    );

    if (send.ok) {
      await supabase
        .from('invoice_reminders')
        .update({ status: 'ENVIADO', sent_comm_id: enq.commId })
        .eq('id', rem.id);
      await supabase.from('invoice_events').insert({
        invoice_id: invoice.id,
        event_type: rem.step_kind === 'ENVIO_FACTURA' ? 'SENT' : 'REMINDER_SENT',
        payload: { step: rem.step_kind, channel, commId: enq.commId },
      });
      await refreshInvoiceStatus(supabase, clinicId, invoice.id, now);
      outcomes.push({ reminderId: rem.id, invoiceId: rem.invoice_id, action: 'ENVIADO', channel });
    } else if (send.transient) {
      // Causa transitoria (WhatsApp desconectado, integración caída): NO se
      // pierde el recordatorio. Se reprograma a la próxima ventana hábil; en el
      // siguiente barrido el canal caído ya no figura conectado y la selección
      // omnicanal cae al otro canal legal (si lo hay).
      const base = new Date(now);
      base.setDate(base.getDate() + 1);
      base.setHours(7, 0, 0, 0);
      const next = nextAllowedTime(base, holidays);
      await supabase
        .from('invoice_reminders')
        .update({ scheduled_for: next.toISOString() })
        .eq('id', rem.id);
      outcomes.push({ reminderId: rem.id, invoiceId: rem.invoice_id, action: 'REPROGRAMADO', reason: 'CANAL_NO_DISPONIBLE', channel });
    } else {
      // Fallo de entrega definitivo: tarea humana y se reintenta la próxima corrida.
      if (ownerId) {
        await openHumanTask(supabase, clinicId, {
          kind: 'MENSAJE_NO_ENTREGADO',
          invoiceId: invoice.id,
          ownerId,
          title: `No se pudo entregar el recordatorio de ${number}`,
          payload: { channel, error: send.error },
        });
      }
      outcomes.push({ reminderId: rem.id, invoiceId: rem.invoice_id, action: 'OMITIDO', reason: 'ENVIO_FALLIDO', channel });
    }
  }
  return outcomes;
}

// ─── Barrido combinado (lo llama el cron) ────────────────────────────────────

export interface SweepResult {
  plan: PlanResult;
  dispatched: DispatchOutcome[];
}

export async function runCarteraSweepForClinic(
  supabase: SupabaseClient,
  clinicId: string,
  settings: BillingSettingsRow,
  now = new Date(),
  injectedPort?: MessagingPort,
): Promise<SweepResult> {
  if (!settings.reminders_enabled) {
    return { plan: { invoicesPlanned: 0, remindersCreated: 0, promisesExpired: 0 }, dispatched: [] };
  }
  // Antes de tocar nada: si el proceso no quedó en la zona del negocio, abortar. Un recordatorio
  // que no sale se reintenta; una cobranza fuera de la ventana legal no se deshace.
  assertBusinessTimezone();
  const plan = await planNextReminders(supabase, clinicId, settings, now);
  const dispatched = await dispatchDueReminders(supabase, clinicId, settings, now, injectedPort);
  return { plan, dispatched };
}

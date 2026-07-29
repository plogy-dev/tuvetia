-- ─────────────────────────────────────────────────────────────────────────────
-- Tuvetia · Facturación — cartera / recaudo (port multi-tenant por clínica)
-- Consolida cuatro migraciones del repo origen:
--   • 0025_recaudo_emision   — F1: la emisión declara la realidad del pago y
--     nace la 4ª dimensión de estado de invoices: el SEGUIMIENTO de cartera
--     (followup_status), junto a fiscal/collection/delivery.
--   • 0025_facturacion_reminders — consentimiento por canal (channel_authorizations;
--     su tabla billing_reminders NO se porta: el código solo usa invoice_reminders).
--   • 0026_cartera_motor     — el motor de fondo: outbox omnicanal
--     (comm_messages), pasos programados (invoice_reminders), escalamiento a
--     personas (human_tasks) y comprobantes (receipt_attachments + bucket).
--   • 0026_facturacion_payment_methods — medios de pago colombianos reales.
--
-- Motor Ley 2300 de 2023: el DOMINIO (lib/facturacion/domain/reminders.ts y
-- lib/cartera) fuerza ventanas horarias (L-V 7-19, Sáb 8-15, nunca dom/
-- festivos), máximo un contacto por día y detenciones (pago, disputa, promesa,
-- pausa). Estas tablas solo persisten agenda, consentimiento y outbox.
--
-- Adaptaciones del port:
--   • Tenancy clinic_id + autoría created_by (mismo criterio que 0029).
--   • channel_authorizations: el origen la creaba DOS veces (0025 por payer_id
--     y 0026 por owner_id). Aquí se crea UNA vez como superset de ambas formas.
--   • Gmail NO se porta: sin invoice_gmail_threads, sin email_log, sin columna
--     gmail_thread_id en comm_messages. El canal EMAIL queda en la interfaz
--     (checks) pero sin implementación (el scheduler lo salta con log).
--   • Bucket privado `receipts` (reemplaza payment-receipts del origen) con
--     path por clínica: <clinic_id>/...
--   • Sin grants de tabla: RLS estándar del repo (PostgREST opera como
--     authenticated normal).
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ F1 · Recaudo en la emisión (origen 0025_recaudo_emision) ════════════════

-- ─── invoices: dimensión de seguimiento ──────────────────────────────────────
alter table public.invoices
  add column if not exists followup_status text not null default 'NO_REQUERIDO';
alter table public.invoices
  add column if not exists followup_channel text;
alter table public.invoices
  add column if not exists followup_enabled boolean not null default true;

alter table public.invoices drop constraint if exists invoices_followup_status_check;
alter table public.invoices add constraint invoices_followup_status_check
  check (followup_status in
    ('NO_REQUERIDO', 'PROGRAMADO', 'ACTIVO', 'PAUSADO', 'COMPLETADO',
     'CANCELADO', 'REQUIERE_ATENCION_HUMANA'));

alter table public.invoices drop constraint if exists invoices_followup_channel_check;
alter table public.invoices add constraint invoices_followup_channel_check
  check (followup_channel is null or followup_channel in ('WHATSAPP', 'EMAIL'));

-- ─── invoices: nuevos estados de recaudo y entrega ───────────────────────────
-- Recaudo: EN_PROMESA_DE_PAGO (promesa vigente registrada por el cliente).
alter table public.invoices drop constraint if exists invoices_collection_status_check;
alter table public.invoices add constraint invoices_collection_status_check
  check (collection_status in
    ('PENDIENTE', 'PARCIALMENTE_PAGADA', 'PAGADA', 'VENCIDA',
     'EN_DISPUTA', 'EN_PROMESA_DE_PAGO', 'CASTIGADA'));

-- Entrega: EN_COLA (mensaje aceptado por el outbox, aún no enviado).
alter table public.invoices drop constraint if exists invoices_delivery_status_check;
alter table public.invoices add constraint invoices_delivery_status_check
  check (delivery_status in ('NO_ENVIADA', 'EN_COLA', 'ENVIADA', 'ENTREGADA', 'FALLIDA'));

-- (El check de invoice_events se amplía UNA sola vez al final del bloque del
--  motor, con la lista consolidada F1+F2 — evita drop/add duplicado.)

-- ─── billing_settings: término y canal de seguimiento por defecto ────────────
alter table public.billing_settings
  add column if not exists default_payment_terms_days integer not null default 15;
alter table public.billing_settings
  add column if not exists reminder_channel text not null default 'WHATSAPP';
alter table public.billing_settings
  add column if not exists reminder_policy jsonb;

alter table public.billing_settings drop constraint if exists billing_settings_reminder_channel_check;
alter table public.billing_settings add constraint billing_settings_reminder_channel_check
  check (reminder_channel in ('WHATSAPP', 'EMAIL'));

alter table public.billing_settings drop constraint if exists billing_settings_terms_days_check;
alter table public.billing_settings add constraint billing_settings_terms_days_check
  check (default_payment_terms_days between 0 and 365);

-- ─── Índice para el panel de cartera (facturas con seguimiento vivo) ─────────
create index if not exists invoices_followup_idx
  on public.invoices (clinic_id, followup_status)
  where followup_status not in ('NO_REQUERIDO', 'COMPLETADO', 'CANCELADO');


-- ═══ Consentimiento por canal (dedup origen 0025 + 0026) ═════════════════════

-- ─── channel_authorizations ──────────────────────────────────────────────────
-- Autorización del cliente por canal (Ley 2300: sin autorización registrada NO
-- se contacta). El origen la definía DOS veces: 0025 ligada a billing_payers
-- (payer_id + method) y 0026 —la forma operativa del motor de cartera— ligada a
-- owners (owner_id + source). Aquí es UNA tabla superset: al menos uno de los
-- dos vínculos debe existir; el seguimiento se apoya en la autorización vigente
-- (revoked_at is null).
create table if not exists public.channel_authorizations (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,

  owner_id    uuid references public.owners(id) on delete cascade,
  payer_id    uuid references public.billing_payers(id) on delete cascade,

  channel     text not null check (channel in ('WHATSAPP', 'EMAIL')),
  granted     boolean not null default true,
  -- Cómo se obtuvo: la clínica da fe (igual que el consent clínico) o el
  -- cliente confirmó explícitamente por el canal.
  method      text not null default 'vet_attestation'
                check (method in ('vet_attestation', 'client_confirmation')),
  -- Detalle libre del origen del consentimiento (formulario, WhatsApp opt-in,
  -- verbal…).
  source      text,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint channel_authorizations_subject_check
    check (owner_id is not null or payer_id is not null)
);

-- Una sola autorización VIGENTE por (owner, canal) y por (clínica, payer, canal).
create unique index if not exists channel_auth_owner_channel_active_uidx
  on public.channel_authorizations (owner_id, channel)
  where revoked_at is null and owner_id is not null;

create unique index if not exists channel_auth_payer_channel_active_uidx
  on public.channel_authorizations (clinic_id, payer_id, channel)
  where revoked_at is null and payer_id is not null;

create index if not exists channel_auth_clinic_idx
  on public.channel_authorizations (clinic_id);

drop trigger if exists channel_authorizations_touch_updated_at on public.channel_authorizations;
create trigger channel_authorizations_touch_updated_at
  before update on public.channel_authorizations
  for each row execute function public.touch_updated_at();

alter table public.channel_authorizations enable row level security;

drop policy if exists "channel_authorizations_select" on public.channel_authorizations;
create policy "channel_authorizations_select"
  on public.channel_authorizations for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "channel_authorizations_insert" on public.channel_authorizations;
create policy "channel_authorizations_insert"
  on public.channel_authorizations for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "channel_authorizations_update" on public.channel_authorizations;
create policy "channel_authorizations_update"
  on public.channel_authorizations for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "channel_authorizations_delete" on public.channel_authorizations;
create policy "channel_authorizations_delete"
  on public.channel_authorizations for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── billing_reminders: NO portada ──────────────────────────────────────────
-- El cliente la creó en su 0025 pero su código solo usa invoice_reminders; portarla
-- sería una tabla muerta. Si algún día se necesita una agenda de pasos configurable,
-- se crea entonces con este mismo patrón.


-- ═══ F2 · Motor de cartera (origen 0026_cartera_motor) ═══════════════════════

-- ─── comm_messages ───────────────────────────────────────────────────────────
-- OUTBOX unificado de cobranza (distinto de whatsapp_messages, que es de
-- CITAS/inbox). Toda comunicación de cartera — saliente o entrante — pasa por
-- aquí, con trazabilidad de la regla que la autorizó (Ley 2300 §5) e
-- idempotencia. El envío real de WhatsApp sale por sendWhatsAppText (Evolution).
create table if not exists public.comm_messages (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics(id) on delete cascade,
  created_by          uuid references public.profiles(id) on delete set null,
  invoice_id          uuid references public.invoices(id) on delete cascade,
  owner_id            uuid references public.owners(id) on delete set null,

  channel             text not null check (channel in ('WHATSAPP', 'EMAIL')),
  direction           text not null default 'SALIENTE'
                        check (direction in ('SALIENTE', 'ENTRANTE')),
  to_address          text,
  template            text,
  body                text not null default '',
  status              text not null default 'EN_COLA'
                        check (status in ('EN_COLA', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO')),

  provider            text,               -- EVOLUTION | SIMULADO (email: no configurado)
  provider_message_id text,
  wa_conversation_id  uuid,
  authorization_id    uuid references public.channel_authorizations(id) on delete set null,

  -- Clave de idempotencia: {invoice|owner}:{step|intent}:{fecha}. Evita reenvíos.
  idempotency_key     text,
  -- Foto de la regla que autorizó el envío (ventana, contactos del día, semana).
  rule_snapshot       jsonb,

  -- Solo entrantes: intención clasificada + acción determinista tomada.
  intent              text,
  agent_action        text,

  error               text,
  retry_count         integer not null default 0,

  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists comm_messages_idempotency_uidx
  on public.comm_messages (clinic_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists comm_messages_invoice_idx
  on public.comm_messages (invoice_id, created_at)
  where invoice_id is not null;

create index if not exists comm_messages_owner_day_idx
  on public.comm_messages (owner_id, sent_at)
  where direction = 'SALIENTE';

drop trigger if exists comm_messages_touch_updated_at on public.comm_messages;
create trigger comm_messages_touch_updated_at
  before update on public.comm_messages
  for each row execute function public.touch_updated_at();

alter table public.comm_messages enable row level security;

drop policy if exists "comm_messages_select" on public.comm_messages;
create policy "comm_messages_select"
  on public.comm_messages for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "comm_messages_insert" on public.comm_messages;
create policy "comm_messages_insert"
  on public.comm_messages for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "comm_messages_update" on public.comm_messages;
create policy "comm_messages_update"
  on public.comm_messages for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "comm_messages_delete" on public.comm_messages;
create policy "comm_messages_delete"
  on public.comm_messages for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── invoice_reminders ───────────────────────────────────────────────────────
-- Pasos de seguimiento programados por factura, según la política de la
-- clínica. Sin clinic_id directo: RLS vía la factura padre.
create table if not exists public.invoice_reminders (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices(id) on delete cascade,
  step_kind     text not null
                  check (step_kind in
                    ('ENVIO_FACTURA', 'RECORDATORIO_1', 'RECORDATORIO_2',
                     'AVISO_SALDO', 'ESCALAMIENTO')),
  scheduled_for timestamptz not null,
  status        text not null default 'PENDIENTE'
                  check (status in ('PENDIENTE', 'EN_COLA', 'ENVIADO', 'OMITIDO', 'CANCELADO')),
  skipped_reason text,
  sent_comm_id  uuid references public.comm_messages(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists invoice_reminders_due_idx
  on public.invoice_reminders (scheduled_for)
  where status = 'PENDIENTE';

create index if not exists invoice_reminders_invoice_idx
  on public.invoice_reminders (invoice_id);

drop trigger if exists invoice_reminders_touch_updated_at on public.invoice_reminders;
create trigger invoice_reminders_touch_updated_at
  before update on public.invoice_reminders
  for each row execute function public.touch_updated_at();

alter table public.invoice_reminders enable row level security;

drop policy if exists "invoice_reminders_select" on public.invoice_reminders;
create policy "invoice_reminders_select"
  on public.invoice_reminders for select
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_reminders.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "invoice_reminders_insert" on public.invoice_reminders;
create policy "invoice_reminders_insert"
  on public.invoice_reminders for insert
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_reminders.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "invoice_reminders_update" on public.invoice_reminders;
create policy "invoice_reminders_update"
  on public.invoice_reminders for update
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_reminders.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_reminders.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  );

drop policy if exists "invoice_reminders_delete" on public.invoice_reminders;
create policy "invoice_reminders_delete"
  on public.invoice_reminders for delete
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_reminders.invoice_id
        and i.clinic_id = (select private.my_clinic_id())
    )
  );


-- ─── human_tasks ─────────────────────────────────────────────────────────────
-- Escalamiento a una persona de la clínica. El agente jamás decide montos ni
-- plazos: abre una tarea (§4.3).
create table if not exists public.human_tasks (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  created_by   uuid references public.profiles(id) on delete set null,
  kind         text not null
                 check (kind in
                   ('VERIFICAR_COMPROBANTE', 'DISPUTA', 'SOLICITUD_PLAZO',
                    'CONTACTO_SOLICITADO', 'MENSAJE_NO_ENTREGADO', 'OTRO')),
  invoice_id   uuid references public.invoices(id) on delete cascade,
  owner_id     uuid references public.owners(id) on delete set null,
  status       text not null default 'ABIERTA'
                 check (status in ('ABIERTA', 'EN_PROGRESO', 'RESUELTA', 'DESCARTADA')),
  title        text not null default '',
  payload      jsonb,
  resolved_by  uuid references public.profiles(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Una sola tarea ABIERTA por (factura, tipo): evita duplicados por reintento (§9).
create unique index if not exists human_tasks_open_uidx
  on public.human_tasks (invoice_id, kind)
  where status in ('ABIERTA', 'EN_PROGRESO') and invoice_id is not null;

create index if not exists human_tasks_clinic_status_idx
  on public.human_tasks (clinic_id, status);

drop trigger if exists human_tasks_touch_updated_at on public.human_tasks;
create trigger human_tasks_touch_updated_at
  before update on public.human_tasks
  for each row execute function public.touch_updated_at();

alter table public.human_tasks enable row level security;

drop policy if exists "human_tasks_select" on public.human_tasks;
create policy "human_tasks_select"
  on public.human_tasks for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "human_tasks_insert" on public.human_tasks;
create policy "human_tasks_insert"
  on public.human_tasks for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "human_tasks_update" on public.human_tasks;
create policy "human_tasks_update"
  on public.human_tasks for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "human_tasks_delete" on public.human_tasks;
create policy "human_tasks_delete"
  on public.human_tasks for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── receipt_attachments ─────────────────────────────────────────────────────
-- Comprobantes de transferencia recibidos por el agente. Se guardan en el
-- bucket privado `receipts` (path <clinic_id>/...); la verificación la hace
-- una persona (tarea).
create table if not exists public.receipt_attachments (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id) on delete cascade,
  created_by         uuid references public.profiles(id) on delete set null,
  invoice_id         uuid references public.invoices(id) on delete set null,
  comm_message_id    uuid references public.comm_messages(id) on delete set null,
  file_path          text not null,
  content_type       text,
  verified_by_task_id uuid references public.human_tasks(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists receipt_attachments_invoice_idx
  on public.receipt_attachments (invoice_id);

alter table public.receipt_attachments enable row level security;

drop policy if exists "receipt_attachments_select" on public.receipt_attachments;
create policy "receipt_attachments_select"
  on public.receipt_attachments for select
  using (clinic_id = (select private.my_clinic_id()));

drop policy if exists "receipt_attachments_insert" on public.receipt_attachments;
create policy "receipt_attachments_insert"
  on public.receipt_attachments for insert
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "receipt_attachments_update" on public.receipt_attachments;
create policy "receipt_attachments_update"
  on public.receipt_attachments for update
  using (clinic_id = (select private.my_clinic_id()))
  with check (clinic_id = (select private.my_clinic_id()));

drop policy if exists "receipt_attachments_delete" on public.receipt_attachments;
create policy "receipt_attachments_delete"
  on public.receipt_attachments for delete
  using (clinic_id = (select private.my_clinic_id()));


-- ─── Bucket privado de comprobantes ──────────────────────────────────────────
-- Mismo patrón por prefijo <clinic_id>/ que patient-attachments (0019).
-- Las 4 policies (no 3): el servicio de Storage hace INSERT ... RETURNING y sin
-- policy de SELECT el insert se rechaza.
insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', false)
  on conflict (id) do nothing;

drop policy if exists "receipts_storage_select" on storage.objects;
create policy "receipts_storage_select" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

drop policy if exists "receipts_storage_insert" on storage.objects;
create policy "receipts_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

drop policy if exists "receipts_storage_update" on storage.objects;
create policy "receipts_storage_update" on storage.objects
  for update using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

drop policy if exists "receipts_storage_delete" on storage.objects;
create policy "receipts_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );


-- ─── invoice_events: eventos de cartera (lista consolidada F1 + F2) ──────────
alter table public.invoice_events drop constraint if exists invoice_events_event_type_check;
alter table public.invoice_events add constraint invoice_events_event_type_check
  check (event_type in
    ('CREATED', 'ISSUED', 'FISCAL_SUBMITTED', 'FISCAL_VALIDATED', 'FISCAL_REJECTED',
     'QUEUED', 'SENT', 'DELIVERED', 'DELIVERY_FAILED', 'PAYMENT_APPLIED',
     'DISPUTE_OPENED', 'DISPUTE_CLOSED', 'CREDIT_NOTE_APPLIED', 'WRITTEN_OFF',
     'REMINDERS_PAUSED', 'REMINDERS_RESUMED', 'PROMISE_TO_PAY',
     'REMINDER_SENT', 'PROMISE_EXPIRED', 'HUMAN_TASK_OPENED', 'HUMAN_TASK_RESOLVED',
     'CHANNEL_REVOKED'));


-- ═══ Formas de pago colombianas (origen 0026_facturacion_payment_methods) ════
-- Amplía payments.method con los medios reales del día a día: Nequi, Daviplata,
-- tarjeta/datáfono y "otro". ENLACE queda reservado para la pasarela (Fase 2).
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in
    ('EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA', 'ENLACE', 'OTRO'));

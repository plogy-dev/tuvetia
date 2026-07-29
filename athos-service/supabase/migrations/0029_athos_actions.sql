-- 0029: acciones propuestas por Athos (capa agéntica) — flujo proponer → aprobar → ejecutar.
-- Athos (el agente) NUNCA ejecuta escrituras: inserta una fila 'proposed' (service_role) y la
-- ejecución ocurre en Next bajo la SESIÓN del vet que aprueba (las RPCs SECURITY DEFINER ven
-- auth.uid() real). Excepción: modo auto, que solo envía WhatsApp y registra 'executed' directo.
-- Cada transición ejecutar/rechazar escribe además en audit_logs.

create type public.athos_action_status as enum
  ('proposed', 'approved', 'rejected', 'executed', 'failed', 'expired');

create table public.athos_actions (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  patient_id        uuid references public.patients(id) on delete set null,
  owner_id          uuid references public.owners(id) on delete set null,
  conversation_key  text,             -- teléfono (inbox) o patient_id (chat): agrupa propuestas por hilo
  source            text not null check (source in ('chat', 'inbox', 'auto')),
  tool_name         text not null,
  payload           jsonb not null,   -- args validados contra el schema del tool ANTES de insertar
  summary           text not null,    -- resumen humano para la tarjeta de aprobación
  risk              text not null default 'approval' check (risk in ('auto', 'approval')),
  status            public.athos_action_status not null default 'proposed',
  proposed_by_model text,
  created_by        uuid references public.profiles(id) on delete set null,  -- null en source='auto'
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  executed_at       timestamptz,
  result            jsonb,            -- incluye el payload ejecutado si el vet lo editó
  error             text,
  expires_at        timestamptz not null default now() + interval '7 days',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.athos_actions enable row level security;

-- Los miembros de la clínica VEN sus propuestas (tarjetas de aprobación, badge de pendientes).
-- INSERT/UPDATE: sin policies — solo service_role (rutas de Next tras validar sesión y estado).
create policy "athos_actions_select" on public.athos_actions
  for select using (clinic_id = (select private.my_clinic_id()));

create index idx_athos_actions_pending
  on public.athos_actions (clinic_id, status, created_at desc);
create index idx_athos_actions_conversation
  on public.athos_actions (clinic_id, conversation_key, status);

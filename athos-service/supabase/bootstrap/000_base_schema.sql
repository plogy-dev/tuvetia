-- ============================================================
-- TUVETIA — Esquema de base de datos completo
-- Supabase / PostgreSQL
-- Modelo: shared DB + shared schema + clinic_id + RLS
-- Roles: admin (dueño de la suscripción) | vet (invitado por admin)
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ============================================================
-- BLOQUE 1 — CLÍNICA (tenant)
-- ============================================================

create table public.clinics (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  slug                  text unique,
  phone                 text,
  email                 text,
  address               text,
  city                  text,
  country               text default 'CO',
  logo_url              text,
  subscription_status   text not null default 'trial'
                          check (subscription_status in ('trial','active','past_due','canceled')),
  wompi_subscription_id text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 2 — USUARIOS
-- profiles espeja auth.users.
-- clinic_id y role viven acá porque cada usuario pertenece
-- a una sola clínica y tiene un solo rol.
-- ============================================================

create type public.user_role as enum ('admin', 'vet');

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  clinic_id   uuid references public.clinics(id) on delete cascade,
  full_name   text,
  avatar_url  text,
  phone       text,
  role        public.user_role not null default 'vet',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 3 — INVITACIONES
-- El admin genera una invitación con email + rol.
-- El vet acepta y queda vinculado a la clínica.
-- ============================================================

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  email       text not null,
  role        public.user_role not null default 'vet',
  invited_by  uuid not null references public.profiles(id),
  token       text not null unique default encode(gen_random_bytes(32), 'hex'),
  accepted_at timestamptz,
  expires_at  timestamptz not null default now() + interval '7 days',
  created_at  timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 4 — DUEÑOS DE MASCOTA
-- Son clientes de la clínica, no usuarios de la plataforma.
-- ============================================================

create table public.owners (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  full_name   text not null,
  document_id text,
  phone       text,
  email       text,
  address     text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 5 — PACIENTES (mascotas)
-- ============================================================

create type public.patient_sex as enum ('male', 'female', 'unknown');

create table public.patients (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  owner_id    uuid not null references public.owners(id) on delete cascade,
  name        text not null,
  species     text not null,
  breed       text,
  sex         public.patient_sex not null default 'unknown',
  birth_date  date,
  weight_kg   numeric(5,2),
  color       text,
  microchip   text,
  photo_url   text,
  is_deceased boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 6 — ALERGIAS
-- ⚠️ Las severas disparan el gate obligatorio antes de
--    cualquier plan de tratamiento.
-- ============================================================

create type public.allergy_severity as enum ('mild', 'moderate', 'severe');

create table public.allergies (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  allergen    text not null,
  severity    public.allergy_severity not null,
  reaction    text,
  confirmed   boolean not null default false,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 7 — VACUNAS
-- ============================================================

create table public.vaccines (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  vaccine_name    text not null,
  batch_number    text,
  dose            text,
  administered_at date not null,
  next_dose_at    date,
  administered_by uuid references public.profiles(id),
  notes           text,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 8 — MEDICAMENTOS
-- ============================================================

create table public.medications (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  patient_id    uuid not null references public.patients(id) on delete cascade,
  drug_name     text not null,
  dose          text not null,
  frequency     text,
  route         text,
  start_date    date,
  end_date      date,
  is_chronic    boolean not null default false,
  prescribed_by uuid references public.profiles(id),
  notes         text,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 9 — ARCHIVOS DEL PACIENTE
-- ============================================================

create table public.patient_attachments (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  label       text not null,
  file_url    text not null,
  file_type   text,
  file_size   int,
  uploaded_by uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 10 — CITAS
-- ============================================================

create type public.appointment_status as enum (
  'scheduled','confirmed','in_progress','completed','canceled','no_show'
);

create table public.appointments (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  patient_id      uuid references public.patients(id) on delete set null,
  owner_id        uuid references public.owners(id) on delete set null,
  vet_id          uuid references public.profiles(id) on delete set null,
  title           text not null,
  reason          text,
  status          public.appointment_status not null default 'scheduled',
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  google_event_id text,
  notes           text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 11 — CONSULTAS
-- ============================================================

create type public.consultation_status as enum (
  'open','transcribing','generating_note','review','completed'
);

create table public.consultations (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  owner_id        uuid references public.owners(id),
  appointment_id  uuid references public.appointments(id) on delete set null,
  vet_id          uuid not null references public.profiles(id),
  status          public.consultation_status not null default 'open',
  chief_complaint text,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 12 — CONSENTIMIENTO (gate legal Ley 1581)
-- ⚠️ Sin esto no arranca la grabación.
-- ============================================================

create table public.consents (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  patient_id      uuid not null references public.patients(id),
  obtained_by     uuid not null references public.profiles(id),
  text_version    text not null,
  scope           text[] not null,
  obtained_at     timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 13 — AUDIO DE CONSULTA
-- ============================================================

create table public.consultation_audios (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  storage_path    text not null,
  duration_secs   int,
  file_size       int,
  encoding        text,
  retain_until    timestamptz,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 14 — TRANSCRIPCIÓN
-- ============================================================

create table public.transcripts (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  audio_id        uuid references public.consultation_audios(id),
  full_text       text,
  segments        jsonb,
  stt_provider    text default 'deepgram',
  stt_model       text default 'nova-2',
  language        text default 'es',
  created_at      timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 15 — NOTA CLÍNICA SOAP
-- ============================================================

create type public.note_status as enum ('draft','approved','locked');

create table public.clinical_notes (
  id                      uuid primary key default gen_random_uuid(),
  clinic_id               uuid not null references public.clinics(id) on delete cascade,
  consultation_id         uuid not null references public.consultations(id) on delete cascade,
  transcript_id           uuid references public.transcripts(id),
  status                  public.note_status not null default 'draft',
  subjective              text,
  objective               text,
  assessment              text,
  plan                    text,
  ai_generated_at         timestamptz,
  ai_model                text,
  approved_by             uuid references public.profiles(id),
  approved_at             timestamptz,
  locked_by               uuid references public.profiles(id),
  locked_at               timestamptz,
  edit_history            jsonb default '[]',
  allergy_gate_triggered  boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 16 — MENSAJES WHATSAPP
-- ============================================================

create type public.whatsapp_direction  as enum ('inbound','outbound');
create type public.whatsapp_agent_mode as enum ('auto','review','paused','intervene');

create table public.whatsapp_messages (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  owner_id      uuid references public.owners(id) on delete set null,
  wa_message_id text unique,
  wa_phone_from text not null,
  wa_phone_to   text not null,
  direction     public.whatsapp_direction not null,
  body          text,
  media_url     text,
  media_type    text,
  agent_mode    public.whatsapp_agent_mode default 'review',
  sent_by       uuid references public.profiles(id),
  read_at       timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- BLOQUE 17 — CORPUS VETERINARIO (global, sin RLS)
-- ============================================================

create table public.corpus_chunks (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  title       text,
  content     text not null,
  embedding   vector(1536),
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);

create index corpus_chunks_embedding_idx
  on public.corpus_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============================================================
-- BLOQUE 18 — EMBEDDINGS POR PACIENTE (con RLS)
-- ============================================================

create table public.patient_embeddings (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  source_type text not null,
  source_id   uuid not null,
  content     text not null,
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);

create index patient_embeddings_embedding_idx
  on public.patient_embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============================================================
-- BLOQUE 19 — AUDIT LOG
-- ============================================================

create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid references public.clinics(id),
  user_id     uuid references public.profiles(id),
  action      text not null,
  table_name  text,
  record_id   uuid,
  payload     jsonb default '{}',
  ip_address  inet,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- HELPERS RLS
-- ============================================================

create schema if not exists private;

-- Devuelve el clinic_id del usuario actual
create or replace function private.my_clinic_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select clinic_id from public.profiles where id = auth.uid()
$$;

-- Devuelve el rol del usuario actual
create or replace function private.my_role()
returns public.user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ============================================================
-- RLS — habilitar en todas las tablas
-- ============================================================

alter table public.clinics               enable row level security;
alter table public.profiles              enable row level security;
alter table public.invitations           enable row level security;
alter table public.owners                enable row level security;
alter table public.patients              enable row level security;
alter table public.allergies             enable row level security;
alter table public.vaccines              enable row level security;
alter table public.medications           enable row level security;
alter table public.patient_attachments   enable row level security;
alter table public.appointments          enable row level security;
alter table public.consultations         enable row level security;
alter table public.consents              enable row level security;
alter table public.consultation_audios   enable row level security;
alter table public.transcripts           enable row level security;
alter table public.clinical_notes        enable row level security;
alter table public.whatsapp_messages     enable row level security;
alter table public.patient_embeddings    enable row level security;
alter table public.audit_logs            enable row level security;
-- corpus_chunks es global: sin RLS

-- ============================================================
-- POLÍTICAS RLS
-- ============================================================

-- clinics: solo ves tu propia clínica
create policy "clinics_select" on public.clinics
  for select using (id = private.my_clinic_id());

-- Solo el admin puede actualizar la clínica
create policy "clinics_update" on public.clinics
  for update using (
    id = private.my_clinic_id()
    and private.my_role() = 'admin'
  );

-- profiles: ves los perfiles de tu misma clínica
create policy "profiles_select" on public.profiles
  for select using (clinic_id = private.my_clinic_id());

-- Cada usuario edita solo su propio perfil
create policy "profiles_update" on public.profiles
  for update using (id = auth.uid());

-- invitations: solo el admin las ve y las crea
create policy "invitations_select" on public.invitations
  for select using (
    clinic_id = private.my_clinic_id()
    and private.my_role() = 'admin'
  );
create policy "invitations_insert" on public.invitations
  for insert with check (
    clinic_id = private.my_clinic_id()
    and private.my_role() = 'admin'
  );
create policy "invitations_delete" on public.invitations
  for delete using (
    clinic_id = private.my_clinic_id()
    and private.my_role() = 'admin'
  );

-- Macro estándar para tablas de dominio:
-- todos los usuarios de la clínica leen y escriben

create policy "owners_select" on public.owners
  for select using (clinic_id = private.my_clinic_id());
create policy "owners_insert" on public.owners
  for insert with check (clinic_id = private.my_clinic_id());
create policy "owners_update" on public.owners
  for update using (clinic_id = private.my_clinic_id());
create policy "owners_delete" on public.owners
  for delete using (clinic_id = private.my_clinic_id());

create policy "patients_select" on public.patients
  for select using (clinic_id = private.my_clinic_id());
create policy "patients_insert" on public.patients
  for insert with check (clinic_id = private.my_clinic_id());
create policy "patients_update" on public.patients
  for update using (clinic_id = private.my_clinic_id());
create policy "patients_delete" on public.patients
  for delete using (clinic_id = private.my_clinic_id());

create policy "allergies_select" on public.allergies
  for select using (clinic_id = private.my_clinic_id());
create policy "allergies_insert" on public.allergies
  for insert with check (clinic_id = private.my_clinic_id());
create policy "allergies_update" on public.allergies
  for update using (clinic_id = private.my_clinic_id());

create policy "vaccines_select" on public.vaccines
  for select using (clinic_id = private.my_clinic_id());
create policy "vaccines_insert" on public.vaccines
  for insert with check (clinic_id = private.my_clinic_id());
create policy "vaccines_update" on public.vaccines
  for update using (clinic_id = private.my_clinic_id());

create policy "medications_select" on public.medications
  for select using (clinic_id = private.my_clinic_id());
create policy "medications_insert" on public.medications
  for insert with check (clinic_id = private.my_clinic_id());
create policy "medications_update" on public.medications
  for update using (clinic_id = private.my_clinic_id());

create policy "patient_attachments_select" on public.patient_attachments
  for select using (clinic_id = private.my_clinic_id());
create policy "patient_attachments_insert" on public.patient_attachments
  for insert with check (clinic_id = private.my_clinic_id());
create policy "patient_attachments_delete" on public.patient_attachments
  for delete using (clinic_id = private.my_clinic_id());

create policy "appointments_select" on public.appointments
  for select using (clinic_id = private.my_clinic_id());
create policy "appointments_insert" on public.appointments
  for insert with check (clinic_id = private.my_clinic_id());
create policy "appointments_update" on public.appointments
  for update using (clinic_id = private.my_clinic_id());
create policy "appointments_delete" on public.appointments
  for delete using (clinic_id = private.my_clinic_id());

create policy "consultations_select" on public.consultations
  for select using (clinic_id = private.my_clinic_id());
create policy "consultations_insert" on public.consultations
  for insert with check (clinic_id = private.my_clinic_id());
create policy "consultations_update" on public.consultations
  for update using (clinic_id = private.my_clinic_id());

create policy "consents_select" on public.consents
  for select using (clinic_id = private.my_clinic_id());
create policy "consents_insert" on public.consents
  for insert with check (clinic_id = private.my_clinic_id());

create policy "consultation_audios_select" on public.consultation_audios
  for select using (clinic_id = private.my_clinic_id());
create policy "consultation_audios_insert" on public.consultation_audios
  for insert with check (clinic_id = private.my_clinic_id());

create policy "transcripts_select" on public.transcripts
  for select using (clinic_id = private.my_clinic_id());
create policy "transcripts_insert" on public.transcripts
  for insert with check (clinic_id = private.my_clinic_id());

create policy "clinical_notes_select" on public.clinical_notes
  for select using (clinic_id = private.my_clinic_id());
create policy "clinical_notes_insert" on public.clinical_notes
  for insert with check (clinic_id = private.my_clinic_id());
create policy "clinical_notes_update" on public.clinical_notes
  for update using (clinic_id = private.my_clinic_id());

create policy "whatsapp_messages_select" on public.whatsapp_messages
  for select using (clinic_id = private.my_clinic_id());
create policy "whatsapp_messages_insert" on public.whatsapp_messages
  for insert with check (clinic_id = private.my_clinic_id());

create policy "patient_embeddings_select" on public.patient_embeddings
  for select using (clinic_id = private.my_clinic_id());
create policy "patient_embeddings_insert" on public.patient_embeddings
  for insert with check (clinic_id = private.my_clinic_id());

create policy "audit_logs_select" on public.audit_logs
  for select using (clinic_id = private.my_clinic_id());
create policy "audit_logs_insert" on public.audit_logs
  for insert with check (clinic_id = private.my_clinic_id());

-- ============================================================
-- RPC — crear clínica (primer usuario queda como admin)
-- Se llama al completar el pago / registro inicial.
-- ============================================================

create or replace function public.create_clinic(clinic_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  new_clinic_id uuid;
begin
  insert into public.clinics (name)
  values (clinic_name)
  returning id into new_clinic_id;

  -- El primer usuario queda como admin de la clínica
  update public.profiles
  set clinic_id = new_clinic_id,
      role      = 'admin'
  where id = auth.uid();

  return new_clinic_id;
end;
$$;

-- ============================================================
-- RPC — aceptar invitación
-- El vet hace clic en el link, se registra y llama a esto.
-- ============================================================

create or replace function public.accept_invitation(invite_token text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  inv public.invitations%rowtype;
begin
  select * into inv
  from public.invitations
  where token = invite_token
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'Invitación inválida o expirada';
  end if;

  update public.profiles
  set clinic_id = inv.clinic_id,
      role      = inv.role
  where id = auth.uid();

  update public.invitations
  set accepted_at = now()
  where id = inv.id;
end;
$$;

-- ============================================================
-- TRIGGER — auto-crear perfil al registrarse
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- ÍNDICES
-- ============================================================

create index idx_profiles_clinic       on public.profiles(clinic_id);
create index idx_invitations_token     on public.invitations(token);
create index idx_invitations_clinic    on public.invitations(clinic_id);
create index idx_patients_clinic       on public.patients(clinic_id);
create index idx_patients_owner        on public.patients(owner_id);
create index idx_allergies_patient     on public.allergies(patient_id, severity);
create index idx_consultations_patient on public.consultations(patient_id);
create index idx_clinical_notes_cons   on public.clinical_notes(consultation_id);
create index idx_transcripts_cons      on public.transcripts(consultation_id);
create index idx_appointments_starts   on public.appointments(clinic_id, starts_at);
create index idx_whatsapp_clinic       on public.whatsapp_messages(clinic_id, created_at);
create index idx_audit_clinic          on public.audit_logs(clinic_id, created_at);

-- 0030: horarios de atención de la clínica.
-- Requisito de la capa agéntica: sin horarios reales, Athos no puede proponer citas ni responder
-- "¿a qué hora abren?" (el prompt de WhatsApp hoy PROHÍBE inventar horarios porque no existen en
-- el esquema). slot_minutes define la grilla de list_available_slots (horarios − citas).

create table public.clinic_hours (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),  -- 0 = domingo
  opens_at     time not null,
  closes_at    time not null,
  slot_minutes smallint not null default 30 check (slot_minutes between 5 and 240),
  created_at   timestamptz not null default now(),
  constraint clinic_hours_valid_range check (closes_at > opens_at),
  unique (clinic_id, weekday, opens_at)
);

alter table public.clinic_hours enable row level security;

create policy "clinic_hours_select" on public.clinic_hours
  for select using (clinic_id = (select private.my_clinic_id()));
create policy "clinic_hours_insert" on public.clinic_hours
  for insert with check (clinic_id = (select private.my_clinic_id()));
create policy "clinic_hours_update" on public.clinic_hours
  for update using (clinic_id = (select private.my_clinic_id()));
create policy "clinic_hours_delete" on public.clinic_hours
  for delete using (clinic_id = (select private.my_clinic_id()));

create index idx_clinic_hours_clinic on public.clinic_hours (clinic_id, weekday);

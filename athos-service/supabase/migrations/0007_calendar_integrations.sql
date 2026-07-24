-- ============================================================
-- 0007_calendar_integrations.sql
-- Calendario interno (v1b/v1c) — integración con Google Calendar (por vet, opt-in).
--
-- Guarda el refresh_token de Google del vet + el estado de sync (syncToken para pull
-- incremental, y el canal de watch para push notifications). Un registro por (user, provider).
--
-- SEGURIDAD: el refresh_token y el sync_token son secretos. Aunque la RLS deja al dueño ver SU
-- fila (para mostrar "Conectado"), se REVOCA el SELECT de esas dos columnas a anon/authenticated:
-- solo el backend (service_role) las lee/escribe. Así el token nunca llega al navegador vía PostgREST.
-- ============================================================

create table if not exists public.calendar_integrations (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id) on delete cascade,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  provider           text not null default 'google',
  google_calendar_id text not null default 'primary',
  refresh_token      text,                       -- secreto (service_role only)
  sync_token         text,                       -- pull incremental (service_role only)
  channel_id         text,                       -- watch channel (push notifications)
  channel_resource_id text,
  channel_expiration timestamptz,
  connected_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.calendar_integrations enable row level security;

-- El dueño ve/gestiona su propia integración dentro de su clínica.
create policy "calendar_integrations_select" on public.calendar_integrations
  for select using (clinic_id = private.my_clinic_id() and user_id = auth.uid());
create policy "calendar_integrations_insert" on public.calendar_integrations
  for insert with check (clinic_id = private.my_clinic_id() and user_id = auth.uid());
create policy "calendar_integrations_update" on public.calendar_integrations
  for update using (clinic_id = private.my_clinic_id() and user_id = auth.uid());
create policy "calendar_integrations_delete" on public.calendar_integrations
  for delete using (clinic_id = private.my_clinic_id() and user_id = auth.uid());

-- Los secretos no se exponen por PostgREST. OJO: un `revoke select (col)` NO alcanza si el rol tiene
-- SELECT a nivel de tabla (el privilegio de tabla domina). Hay que revocar el SELECT de la tabla y
-- reconceder solo las columnas no-secretas. (El backend usa service_role → se salta RLS y grants.)
revoke select on public.calendar_integrations from anon, authenticated;
grant select (id, clinic_id, user_id, provider, google_calendar_id, channel_expiration, connected_at, updated_at)
  on public.calendar_integrations to authenticated;

comment on column public.calendar_integrations.refresh_token is
  'OAuth refresh token de Google (secreto). SELECT revocado a anon/authenticated; solo service_role.';

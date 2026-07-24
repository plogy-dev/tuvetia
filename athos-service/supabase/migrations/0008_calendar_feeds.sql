-- ============================================================
-- 0008_calendar_feeds.sql
-- Calendario — feed ICS de solo lectura (fallback SIN OAuth de Google).
--
-- Cada clínica tiene una URL secreta (.../api/calendar/ics/<token>) que devuelve sus citas en
-- formato iCalendar. El vet la pega en Google Calendar ("Otros calendarios → Desde URL") y ve su
-- agenda SIN conectar su cuenta ni verificación de Google. Una vía (nosotros → Google), solo lectura.
--
-- El `token` ES la credencial (bearer en la URL, como los ICS privados del propio Google). El endpoint
-- lo lee con service_role (sin RLS), acotando por el clinic_id del token. Los miembros de la clínica
-- pueden LEER su token (para copiarlo); la escritura va por la RPC SECURITY DEFINER.
-- ============================================================

create table if not exists public.calendar_feeds (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null unique references public.clinics(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);

alter table public.calendar_feeds enable row level security;

create policy "calendar_feeds_select" on public.calendar_feeds
  for select using (clinic_id = private.my_clinic_id());

-- Devuelve (creando si no existe) el token del feed ICS de la clínica del usuario.
create or replace function public.ensure_calendar_feed()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clinic_id uuid := private.my_clinic_id();
  v_token text;
begin
  if v_clinic_id is null then
    raise exception 'No clinic assigned to current user';
  end if;
  insert into public.calendar_feeds (clinic_id, token)
  values (v_clinic_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (clinic_id) do nothing;
  select token into v_token from public.calendar_feeds where clinic_id = v_clinic_id;
  return v_token;
end;
$function$;

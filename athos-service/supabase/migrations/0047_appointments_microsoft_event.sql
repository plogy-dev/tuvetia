-- Espejo de 0042/0043 (Google) para el sync con Microsoft/Outlook Calendar: columna para el id remoto
-- del evento + índice único NO parcial (un índice parcial no sirve como target de ON CONFLICT en el
-- upsert por chunks de PostgREST — lección de 0043) para el pull incremental en bloque.
alter table public.appointments
  add column if not exists microsoft_event_id text;

create unique index if not exists appointments_clinic_microsoft_event_uidx
  on public.appointments (clinic_id, microsoft_event_id);

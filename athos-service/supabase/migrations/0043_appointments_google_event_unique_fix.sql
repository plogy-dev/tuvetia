-- 0042 creó un índice único PARCIAL (where google_event_id is not null). Postgres no lo usa como
-- target de ON CONFLICT (clinic_id, google_event_id) sin repetir ese WHERE ahí, y el .upsert() de
-- PostgREST/Supabase no permite especificar ese predicado en el conflict target -> "there is no
-- unique or exclusion constraint matching the ON CONFLICT specification" (visto en producción al
-- sincronizar Google Calendar, 2026-07-31). Reemplazado por un índice único NO parcial: los NULL en
-- google_event_id no violan unicidad entre sí (semántica estándar de Postgres), así que sigue sin
-- bloquear citas que no vienen de Google.
drop index if exists public.appointments_clinic_google_event_uidx;
create unique index if not exists appointments_clinic_google_event_uidx
  on public.appointments (clinic_id, google_event_id);

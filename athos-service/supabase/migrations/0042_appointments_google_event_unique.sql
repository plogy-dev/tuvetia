-- Índice único para upsert en bloque desde el pull de Google Calendar (evita el fila-por-fila que
-- causó el incidente 2026-07-31: 1.567 eventos personales importados con SELECT+INSERT/UPDATE
-- secuencial por evento colgaron la carga de /dashboard/calendario).
create unique index if not exists appointments_clinic_google_event_uidx
  on public.appointments (clinic_id, google_event_id)
  where google_event_id is not null;

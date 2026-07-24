-- ============================================================
-- 0019_audio_retention_4_days.sql
-- Alineación con la promesa pública: el audio de consulta se elimina a los 4 días (antes 7).
-- El transcript se conserva. El cron de purga (/api/cron/purge-audio) no cambia: usa retain_until.
-- ============================================================

alter table public.consultation_audios
  alter column retain_until set default (now() + interval '4 days');

-- Backfill: audios aún no purgados pasan a la ventana de 4 días desde su creación
-- (si ya la excedieron, la próxima corrida del cron los purga).
update public.consultation_audios
   set retain_until = created_at + interval '4 days'
 where storage_path is not null;

comment on column public.consultation_audios.retain_until is
  'Audio se borra a los 4 días (job de purga: borra del bucket y anula storage_path). El transcript se conserva — política de retención del transcript: ADR-0018, abierta.';

-- ============================================================
-- 0012_audio_storage_path_nullable.sql
-- Habilita la purga de audio a 7 días: el job anula `storage_path` tras borrar el archivo del bucket,
-- conservando la fila (duración, vínculo con el transcript, auditoría). Antes era NOT NULL y bloqueaba
-- esa anulación. El índice parcial consultation_audios_retention_idx (where storage_path is not null)
-- ya soporta la búsqueda de audio vencido y ahora sí discrimina lo ya purgado.
-- ============================================================

alter table public.consultation_audios alter column storage_path drop not null;

-- ============================================================
-- 0014_hot_path_indexes.sql
-- Perf: índices de cobertura para las rutas calientes del front (advisor unindexed_foreign_keys).
-- Son exactamente las queries de la historia del paciente y la página de consulta:
--   consultations por patient_id · transcripts/clinical_notes/consultation_audios por consultation_id.
-- ============================================================

create index if not exists consultations_patient_idx      on public.consultations (patient_id);
create index if not exists transcripts_consultation_idx   on public.transcripts (consultation_id);
create index if not exists clinical_notes_consultation_idx on public.clinical_notes (consultation_id);
create index if not exists consultation_audios_consultation_idx on public.consultation_audios (consultation_id);

-- ============================================================
-- 0020_hot_path_indexes_extra.sql
-- Índices adicionales del hot-path del lado paciente (extiende 0014_hot_path_indexes).
-- Solo aceleran LECTURAS (btree); costo de escritura marginal. Detectados en la auditoría
-- de rendimiento 2026-07-24: sin ellos, seq scans que empeoran al crecer los datos.
--   - athos_messages: memoria del hilo del chat (se lee en CADA turno del Copiloto).
--   - medications/vaccines/patient_attachments: la ficha del paciente los carga por patient_id.
--   - patients/consultations: orden de los listados (created_at / started_at desc).
-- ============================================================

create index if not exists athos_messages_thread_idx
  on public.athos_messages (clinic_id, patient_id, created_at desc);

create index if not exists medications_patient_idx
  on public.medications (clinic_id, patient_id);

create index if not exists vaccines_patient_idx
  on public.vaccines (patient_id);

create index if not exists patient_attachments_patient_idx
  on public.patient_attachments (patient_id);

create index if not exists patients_clinic_created_idx
  on public.patients (clinic_id, created_at desc);

create index if not exists consultations_clinic_started_idx
  on public.consultations (clinic_id, started_at desc);

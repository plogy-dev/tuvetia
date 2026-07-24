-- ============================================================
-- 0011_appointment_fk_indexes.sql
-- Perf: índices de cobertura para las FKs de appointments que se usan en listados/joins
-- (agenda por paciente, por vet, por titular). Resuelve unindexed_foreign_keys en esas columnas.
-- (El índice principal por fecha ya existe: idx_appointments_starts (clinic_id, starts_at).)
-- ============================================================

create index if not exists appointments_patient_idx on public.appointments (patient_id);
create index if not exists appointments_vet_idx     on public.appointments (vet_id);
create index if not exists appointments_owner_idx    on public.appointments (owner_id);

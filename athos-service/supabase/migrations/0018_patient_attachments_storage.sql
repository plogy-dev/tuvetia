-- ============================================================
-- 0018_patient_attachments_storage.sql
-- Archivos adjuntos del paciente (exámenes, radiografías, etc.)
--
-- La tabla public.patient_attachments YA existe (000_base_schema.sql) con RLS
-- select/insert/delete por clínica. Esto agrega el bucket PRIVADO
-- `patient-attachments` + las 4 policies de Storage (select/insert/update/
-- delete — las 4, no 3: el servicio de Storage hace INSERT ... RETURNING y sin
-- policy de SELECT el insert se rechaza; mismo patrón que 0005).
--
-- Convención de ruta:  <clinic_id>/<patient_id>/<attachment_id>.<ext>
-- El primer segmento es el clinic_id -> es lo que usan las policies para aislar.
-- `patient_attachments.file_url` guarda esa RUTA (bucket privado: el front pide
-- una signed URL al abrir, igual que consultation-audios).
-- ============================================================

insert into storage.buckets (id, name, public)
values ('patient-attachments', 'patient-attachments', false)
on conflict (id) do nothing;

drop policy if exists "patient_attachments_storage_select" on storage.objects;
create policy "patient_attachments_storage_select" on storage.objects
  for select using (
    bucket_id = 'patient-attachments'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

drop policy if exists "patient_attachments_storage_insert" on storage.objects;
create policy "patient_attachments_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'patient-attachments'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

drop policy if exists "patient_attachments_storage_update" on storage.objects;
create policy "patient_attachments_storage_update" on storage.objects
  for update using (
    bucket_id = 'patient-attachments'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

drop policy if exists "patient_attachments_storage_delete" on storage.objects;
create policy "patient_attachments_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'patient-attachments'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

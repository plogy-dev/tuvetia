-- El servicio de Storage hace INSERT ... RETURNING al subir un archivo: sin policy de SELECT
-- el insert se rechaza por RLS aunque el bucket sea publico (mismo bug ya corregido antes para
-- patient-photos, ver comentario en 0019_patient_attachments_storage.sql). Se omitio en
-- 0023_clinic_logos_storage.sql -- este migration lo agrega.
-- Bucket publico: se lee via URL/CDN sin pasar por RLS, asi que no hace falta restringir por clinica.
drop policy if exists "clinic_logos_storage_select" on storage.objects;
create policy "clinic_logos_storage_select" on storage.objects
  for select using (bucket_id = 'clinic-logos');

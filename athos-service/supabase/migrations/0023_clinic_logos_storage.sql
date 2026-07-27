-- Bucket PUBLICO para logos de clinica (igual a patient-photos: se usa directo como <img src>,
-- sin signed URLs). Ruta <clinic_id>/logo.<ext> -- solo el admin de esa clinica puede
-- subir/reemplazar/borrar (mismo criterio que la policy clinics_update).
insert into storage.buckets (id, name, public)
values ('clinic-logos', 'clinic-logos', true)
on conflict (id) do nothing;

drop policy if exists "clinic_logos_storage_insert" on storage.objects;
create policy "clinic_logos_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'clinic-logos'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
    and private.my_role() = 'admin'
  );

drop policy if exists "clinic_logos_storage_update" on storage.objects;
create policy "clinic_logos_storage_update" on storage.objects
  for update using (
    bucket_id = 'clinic-logos'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
    and private.my_role() = 'admin'
  );

drop policy if exists "clinic_logos_storage_delete" on storage.objects;
create policy "clinic_logos_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'clinic-logos'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
    and private.my_role() = 'admin'
  );
-- Sin policy de select: el bucket es publico, se lee via URL publica del CDN, no via API con RLS.

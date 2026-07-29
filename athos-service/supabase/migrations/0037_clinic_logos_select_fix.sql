-- 0037: repara la subida de logos que rompió 0026.
--
-- QUÉ PASÓ
-- 0026_security_hardening borró `clinic_logos_storage_select` razonando que un bucket público se
-- lee por URL del CDN y no necesita policy de SELECT. Eso es cierto para LEER, pero no para
-- ESCRIBIR: el servicio de Storage hace `INSERT ... RETURNING` al subir, y sin policy de SELECT la
-- RLS rechaza el insert aunque el bucket sea público.
--
-- Es exactamente el bug que 0024_clinic_logos_select_policy había arreglado (y antes de eso,
-- 0019_patient_attachments_storage para patient-photos). O sea: 0026 reintrodujo una regresión ya
-- conocida y documentada. Consecuencia en producción: subir el logo de la clínica falla —
-- onboarding (workspace-setup) y Configuración.
--
-- LA CORRECCIÓN
-- Se restaura la policy, pero ACOTADA POR CLÍNICA en vez del `bucket_id = 'clinic-logos'` a secas
-- que tenía 0024. Así se arregla la subida y además se conserva lo que 0026 buscaba: que un usuario
-- autenticado no pueda LISTAR los objetos de otras clínicas.
--
-- Funciona con el INSERT ... RETURNING porque la fila recién insertada vive bajo la carpeta de la
-- propia clínica (lo impone el with_check del policy de insert), así que el SELECT la ve.
-- El acceso público por URL/CDN no pasa por RLS y sigue igual.
--
-- Mismo patrón que ya usan consultation-audios, patient-attachments y receipts.

drop policy if exists "clinic_logos_storage_select" on storage.objects;

create policy "clinic_logos_storage_select" on storage.objects
  for select using (
    bucket_id = 'clinic-logos'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

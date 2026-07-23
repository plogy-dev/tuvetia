-- ============================================================
-- 0004_phantom_audio_storage.sql
-- E5 · Modo Fantasma — la mitad que faltaba: audio + consentimiento duro.
--
-- El esquema de consultations/consents/consultation_audios/transcripts/
-- clinical_notes YA existe (000_base_schema.sql). Esto agrega:
--   1. Bucket PRIVADO `consultation-audios` + las 4 policies (select/insert/
--      update/delete). Las 4, no 3: el servicio de Storage hace
--      INSERT ... RETURNING y sin policy de SELECT el insert se rechaza
--      (ver DATABASE.md, sección Storage — ya nos pasó con patient-photos).
--   2. Trigger que BLOQUEA insertar audio sin consentimiento previo (Ley 1581).
--      El no negociable deja de depender de que la UI se porte bien.
--   3. retain_until por defecto a 7 días + índice para el job de purga.
--
-- Convención de ruta:  <clinic_id>/<consultation_id>/<audio_id>.webm
-- El primer segmento es el clinic_id -> es lo que usan las policies para aislar.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Bucket privado
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('consultation-audios', 'consultation-audios', false)
on conflict (id) do nothing;

-- Las 4 policies, aisladas por clínica vía el primer segmento de la ruta.
create policy "consultation_audios_storage_select" on storage.objects
  for select using (
    bucket_id = 'consultation-audios'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

create policy "consultation_audios_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'consultation-audios'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

create policy "consultation_audios_storage_update" on storage.objects
  for update using (
    bucket_id = 'consultation-audios'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

create policy "consultation_audios_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'consultation-audios'
    and (storage.foldername(name))[1] = private.my_clinic_id()::text
  );

-- ------------------------------------------------------------
-- 2. NO NEGOCIABLE: sin consentimiento no hay audio (Ley 1581)
-- ------------------------------------------------------------
create or replace function private.enforce_consent_before_audio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.consents c
    where c.consultation_id = new.consultation_id
      and c.clinic_id       = new.clinic_id
  ) then
    raise exception
      'Ley 1581: no se puede registrar audio sin consentimiento previo para la consulta %',
      new.consultation_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger consultation_audios_require_consent
  before insert on public.consultation_audios
  for each row execute function private.enforce_consent_before_audio();

-- ------------------------------------------------------------
-- 3. Retención de audio: 7 días por defecto (el transcript se conserva)
-- ------------------------------------------------------------
alter table public.consultation_audios
  alter column retain_until set default (now() + interval '7 days');

-- Backfill de filas existentes sin retención definida
update public.consultation_audios
   set retain_until = created_at + interval '7 days'
 where retain_until is null;

-- Índice para el job de purga (busca audio vencido que todavía tiene archivo)
create index if not exists consultation_audios_retention_idx
  on public.consultation_audios (retain_until)
  where storage_path is not null;

comment on column public.consultation_audios.retain_until is
  'Audio se borra a los 7 días (job de purga: anula storage_path). El transcript se conserva — política de retención del transcript: ADR-0018, abierta.';

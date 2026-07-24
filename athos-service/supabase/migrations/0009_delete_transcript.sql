-- ============================================================
-- 0009_delete_transcript.sql
-- Permite borrar una transcripción desde la historia del paciente.
--
-- `transcripts` no tiene policy de DELETE y la FK clinical_notes.transcript_id es NO ACTION
-- (borrar un transcript referenciado por una nota fallaría). Esta RPC lo resuelve sin tocar la FK
-- en prod: valida la clínica, DESVINCULA la nota (transcript_id = null) y borra el transcript.
--
-- Alcance: SOLO la transcripción (texto/segmentos). El audio queda y se auto-purga a los 7 días
-- (retain_until), así que la consulta se puede re-transcribir mientras el audio siga disponible.
-- ============================================================

create or replace function public.delete_transcript(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clinic_id uuid := private.my_clinic_id();
begin
  if v_clinic_id is null then
    raise exception 'No clinic assigned to current user';
  end if;

  if not exists (
    select 1 from public.transcripts where id = p_id and clinic_id = v_clinic_id
  ) then
    raise exception 'Transcript does not belong to your clinic';
  end if;

  update public.clinical_notes
     set transcript_id = null
   where transcript_id = p_id and clinic_id = v_clinic_id;

  delete from public.transcripts where id = p_id and clinic_id = v_clinic_id;
end;
$function$;

-- patient_embeddings: cerrar la carrera de indexado de la memoria del paciente.
--
-- `index_patient_memory` (app/patient_memory.py) decide qué embeber con un NOT EXISTS y después
-- inserta. Entre ese SELECT y el INSERT —o entre dos chats simultáneos del MISMO paciente— ambos ven
-- la misma nota/transcripción como pendiente, ambos la embeben (doble costo Cohere) y ambos la
-- insertan. Resultado: snippets duplicados que `search_patient_memory` devuelve repetidos al prompt.
--
-- La clave natural de una fuente indexada es (clinic_id, source_type, source_id). Con el UNIQUE, el
-- `on conflict do nothing` del INSERT vuelve la operación idempotente de verdad y la carrera se cierra
-- en la base, no en el código.

-- 1) Dedup, por si algún entorno ya disparó la carrera: conserva UNA fila por grupo (la primera
--    físicamente; el contenido es idéntico, así que cuál se conserva da igual).
delete from public.patient_embeddings a
  using public.patient_embeddings b
  where a.clinic_id = b.clinic_id
    and a.source_type = b.source_type
    and a.source_id = b.source_id
    and a.ctid > b.ctid;

-- 2) UNIQUE, idempotente (no falla si ya está aplicado).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patient_embeddings_fuente_unica') then
    alter table public.patient_embeddings
      add constraint patient_embeddings_fuente_unica
      unique (clinic_id, source_type, source_id);
  end if;
end $$;

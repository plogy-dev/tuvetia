-- Borrar una clínica entera, y que termine.
--
-- ── POR QUÉ EXISTE ESTE ARCHIVO ─────────────────────────────────────────────────────────────────
--
-- `delete from public.clinics where id = ...` NO FUNCIONA. Falla con violación de clave foránea en
-- cuanto la clínica haya tenido un titular, un paciente, una consulta o una cita — o sea, siempre.
-- Medido contra el principal el 27-ago; el detalle está en `docs/AUDITORIA-2026-08-27.md` §1.
--
-- La cadena es ésta:
--
--   · De las 61 claves foráneas que apuntan a `clinics`, 60 son `on delete cascade` y UNA no:
--     `audit_logs_clinic_id_fkey` es `no action`, que bloquea.
--   · La 0063 puso triggers AFTER DELETE en `appointments`, `consultations`, `owners` y `patients`
--     (`*_traza`), y esos triggers INSERTAN en `audit_logs` con el `clinic_id` de la fila borrada.
--   · Entonces el propio cascade genera las filas que impiden que el cascade termine.
--
-- Y hay 9 cadenas `restrict` dentro de la clínica (facturación y planes de salud). `restrict` se
-- evalúa de inmediato, no se difiere al fin del statement como `no action`, así que le gana a
-- cualquier cascade del mismo statement: una clínica con facturas es imposible de borrar de un solo
-- comando aunque `audit_logs` no existiera.
--
-- ── QUÉ HACE ────────────────────────────────────────────────────────────────────────────────────
--
-- Borra hoja→raíz en el orden que impone el grafo real de FK (profundidad 7 → 0), con dos ajustes
-- que el orden topológico por sí solo NO da:
--
--   1. Las tablas SIN `clinic_id` que bloquean con `restrict` (`payment_applications`,
--      `health_plan_items`, `health_plan_uses`) se borran por subconsulta contra su padre. No
--      aparecen en ningún recuento por clínica, así que es fácil olvidarlas y descubrirlas cuando
--      el borrado ya falló a mitad.
--   2. `audit_logs` va AL FINAL, después de las cuatro tablas con trigger `*_traza`. Su
--      profundidad de FK la pondría antes, y ahí el borrado de `owners` la volvería a llenar.
--
-- ── CÓMO SE USA ─────────────────────────────────────────────────────────────────────────────────
--
--   psql "<CADENA>" -v clinica="'00000000-0000-0000-0000-000000000000'" -f borrar_una_clinica.sql
--
-- ENSAYALO PRIMERO. El archivo abre en `begin` y termina en `rollback` a propósito: tal como está,
-- NO BORRA NADA — corre todo, te muestra el recuento final y deshace. Cuando el recuento dé cero y
-- estés seguro, cambiás la última línea por `commit`.
--
-- ── LO QUE ESTE ARCHIVO NO HACE ─────────────────────────────────────────────────────────────────
--
--   · No borra el usuario de `auth.users`. `clinics.owner_id → profiles` es `on delete set null` y
--     `profiles.id → auth.users` es cascade, así que borrar la clínica no toca al usuario. Va
--     aparte, por la Admin API.
--   · No borra objetos de Storage (fotos de pacientes, logo, audios de consulta).
--   · No hace `analyze`. Si la clínica era grande, conviene después.

\set ON_ERROR_STOP on

begin;

-- ── 0 · La red de seguridad ─────────────────────────────────────────────────────────────────────
--
-- Sin esto, un `:clinica` vacío o mal escrito convierte cada `delete ... where clinic_id = null` en
-- un borrado de cero filas —silencioso, parece que funcionó— y el `delete from clinics` final se
-- lleva por delante lo que no debía. Que falle acá y no a la mitad.
do $$
begin
  if :clinica::uuid is null then
    raise exception 'Falta la variable :clinica. Pasala con -v clinica="''<uuid>''"';
  end if;
  if not exists (select 1 from public.clinics where id = :clinica::uuid) then
    raise exception 'No existe ninguna clínica con id %', :clinica::uuid;
  end if;
  raise notice 'Borrando la clínica % (%)',
    :clinica::uuid, (select name from public.clinics where id = :clinica::uuid);
end
$$;

-- ── 1 · Las que NO tienen `clinic_id` y bloquean con `restrict` ─────────────────────────────────
--
-- Van primero porque no hay forma de alcanzarlas por `clinic_id`: se llega por su padre. Si se
-- dejan para después, el borrado del padre falla y ya hay medio árbol borrado.
delete from public.payment_applications
 where invoice_id in (select id from public.invoices where clinic_id = :clinica::uuid);

delete from public.health_plan_uses
 where catalog_item_id in (select id from public.catalog_items where clinic_id = :clinica::uuid)
    or plan_id in (select id from public.health_plans where clinic_id = :clinica::uuid);

delete from public.health_plan_items
 where catalog_item_id in (select id from public.catalog_items where clinic_id = :clinica::uuid)
    or plan_id in (select id from public.health_plans where clinic_id = :clinica::uuid);

-- ── 2 · Profundidad 7 → 1 ───────────────────────────────────────────────────────────────────────
--
-- El orden sale del grafo de FK, no de la intuición. Los `restrict` de facturación quedan
-- satisfechos solos: `fiscal_documents`(6) antes que `credit_notes`(5), antes que `invoices`(4),
-- antes que `numbering_ranges` y `billing_payers`(1).

-- 7
delete from public.rag_answer_log        where clinic_id = :clinica::uuid;
-- 6
delete from public.clinical_notes        where clinic_id = :clinica::uuid;
delete from public.fiscal_documents      where clinic_id = :clinica::uuid;
delete from public.receipt_attachments   where clinic_id = :clinica::uuid;
-- 5
delete from public.comm_messages         where clinic_id = :clinica::uuid;
delete from public.credit_notes          where clinic_id = :clinica::uuid;
delete from public.human_tasks           where clinic_id = :clinica::uuid;
delete from public.invoice_email_threads where clinic_id = :clinica::uuid;
delete from public.transcripts           where clinic_id = :clinica::uuid;
-- 4
delete from public.client_reports        where clinic_id = :clinica::uuid;
delete from public.consents              where clinic_id = :clinica::uuid;
delete from public.consultation_audios   where clinic_id = :clinica::uuid;
delete from public.invoices              where clinic_id = :clinica::uuid;
-- 3
delete from public.consultations         where clinic_id = :clinica::uuid;
delete from public.expenses              where clinic_id = :clinica::uuid;
delete from public.inventory_movements   where clinic_id = :clinica::uuid;
delete from public.purchase_items        where clinic_id = :clinica::uuid;
delete from public.service_consumptions  where clinic_id = :clinica::uuid;
-- 2
delete from public.allergies             where clinic_id = :clinica::uuid;
delete from public.appointments          where clinic_id = :clinica::uuid;
delete from public.athos_actions         where clinic_id = :clinica::uuid;
delete from public.catalog_items         where clinic_id = :clinica::uuid;
delete from public.channel_authorizations where clinic_id = :clinica::uuid;
delete from public.email_messages        where clinic_id = :clinica::uuid;
delete from public.medications           where clinic_id = :clinica::uuid;
delete from public.patient_attachments   where clinic_id = :clinica::uuid;
delete from public.patient_embeddings    where clinic_id = :clinica::uuid;
delete from public.patient_health_plans  where clinic_id = :clinica::uuid;
delete from public.purchases             where clinic_id = :clinica::uuid;
delete from public.vaccines              where clinic_id = :clinica::uuid;
-- 1  (sin `audit_logs`: va al final, ver el bloque 4)
delete from public.athos_agent_usage     where clinic_id = :clinica::uuid;
delete from public.billing_payers        where clinic_id = :clinica::uuid;
delete from public.billing_settings      where clinic_id = :clinica::uuid;
delete from public.calendar_integrations where clinic_id = :clinica::uuid;
delete from public.catalog_categories    where clinic_id = :clinica::uuid;
delete from public.clinic_hours          where clinic_id = :clinica::uuid;
delete from public.email_integrations    where clinic_id = :clinica::uuid;
delete from public.email_threads         where clinic_id = :clinica::uuid;
delete from public.health_plans          where clinic_id = :clinica::uuid;
delete from public.import_batches        where clinic_id = :clinica::uuid;
delete from public.invitations           where clinic_id = :clinica::uuid;
delete from public.memberships           where clinic_id = :clinica::uuid;
delete from public.numbering_ranges      where clinic_id = :clinica::uuid;
delete from public.owner_email_optout    where clinic_id = :clinica::uuid;
delete from public.patients              where clinic_id = :clinica::uuid;
delete from public.payments              where clinic_id = :clinica::uuid;
delete from public.suppliers             where clinic_id = :clinica::uuid;
delete from public.tablero_default_clinica where clinic_id = :clinica::uuid;
delete from public.tablero_preferencias  where clinic_id = :clinica::uuid;
delete from public.vaccine_types         where clinic_id = :clinica::uuid;
delete from public.whatsapp_integrations where clinic_id = :clinica::uuid;
delete from public.whatsapp_messages     where clinic_id = :clinica::uuid;

-- ── 3 · Profundidad 0, MENOS `profiles` ─────────────────────────────────────────────────────────
--
-- `profiles` se queda para el bloque 5: `audit_logs.actor_id` lo referencia con `no action`, así
-- que borrarlo antes de vaciar `audit_logs` vuelve a bloquear.
delete from public.appointments_importadas_respaldo where clinic_id = :clinica::uuid;
delete from public.athos_messages        where clinic_id = :clinica::uuid;
delete from public.calendar_feeds        where clinic_id = :clinica::uuid;
delete from public.clinic_briefings      where clinic_id = :clinica::uuid;
delete from public.rag_retrieval_log     where clinic_id = :clinica::uuid;
delete from public.suscripcion_cobros    where clinic_id = :clinica::uuid;
delete from public.owners                where clinic_id = :clinica::uuid;

-- ── 4 · La traza que acaban de escribir los bloques 2 y 3 ───────────────────────────────────────
--
-- ÉSTE ES EL PASO QUE FALTA EN TODOS LOS INTENTOS. Los triggers `*_traza` de `appointments`,
-- `consultations`, `owners` y `patients` son AFTER DELETE: cada fila borrada arriba dejó una fila
-- nueva acá, apuntando a una clínica que estamos por borrar. Vaciar `audit_logs` antes no sirve de
-- nada — hay que hacerlo DESPUÉS.
delete from public.audit_logs where clinic_id = :clinica::uuid;

-- ── 5 · La raíz ─────────────────────────────────────────────────────────────────────────────────
--
-- `profiles` explícito y no por cascade: así lo único que queda apoyado en el cascade de `clinics`
-- es lo que ya no tiene hijos. Un cascade que no tiene nada que hacer no puede sorprender.
delete from public.profiles where clinic_id = :clinica::uuid;
delete from public.clinics  where id = :clinica::uuid;

-- ── 6 · La verificación, dentro de la misma transacción ─────────────────────────────────────────
--
-- Recorre las 61 tablas con `clinic_id` y suma lo que quedó. Tiene que dar 0. Si da otra cosa, el
-- `rollback` de abajo deshace todo y el número te dice en qué tabla mirar.
do $$
declare
  t record;
  n bigint;
  total bigint := 0;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join information_schema.columns col
      on col.table_name = c.relname and col.column_name = 'clinic_id' and col.table_schema = 'public'
    where ns.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('select count(*) from public.%I where clinic_id = $1', t.relname)
      into n using :clinica::uuid;
    if n > 0 then
      raise notice 'QUEDAN % filas en %', n, t.relname;
      total := total + n;
    end if;
  end loop;

  if total = 0 then
    raise notice 'Limpio: no queda ninguna fila de esa clínica.';
  else
    raise exception 'Quedaron % filas sin borrar. Se deshace todo.', total;
  end if;
end
$$;

-- ── ENSAYO POR DEFECTO ──────────────────────────────────────────────────────────────────────────
--
-- Cambiá esta línea por `commit;` sólo cuando el bloque 6 haya dicho «Limpio».
rollback;

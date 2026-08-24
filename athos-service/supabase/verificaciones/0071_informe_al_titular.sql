-- Verificación de la 0071 — el informe que se lleva el titular.
--
-- LO QUE MÁS IMPORTA ACÁ ES UNA REGLA DE BORRADO, y no se puede mirar en el catálogo: `created_by`
-- es `on delete set null` y no `cascade` A PROPÓSITO — si la persona que entregó el informe se va
-- de la clínica, el informe **no se borra**, porque es justamente el registro que una auditoría
-- necesita que sobreviva. Un `cascade` puesto por descuido se ve idéntico en el `\d` y borra la
-- evidencia el día que alguien da de baja a un empleado.
--
-- Así que se monta el caso: informe entregado por alguien, se borra a ese alguien, y el informe
-- tiene que seguir ahí con el autor en null.
--
-- Todo se deshace con el `raise exception` final, incluido el perfil de prueba.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0071.

do $$
declare
  v_clinic   uuid;
  v_consulta uuid;
  v_autor    uuid := gen_random_uuid();
  v_informe  uuid;
  v_tras     uuid;
  v_regla    text;
  v_n        int;
begin
  select c.id, c.clinic_id into v_consulta, v_clinic
    from public.consultations c order by c.created_at desc limit 1;
  if v_consulta is null then
    raise exception 'hace falta al menos una consulta';
  end if;

  -- ── 1. La regla está DECLARADA como SET NULL ────────────────────────────────────────────────
  select case con.confdeltype when 'n' then 'SET NULL' when 'c' then 'CASCADE'
                              when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
                              else con.confdeltype::text end
    into v_regla
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
   where rel.relname = 'client_reports' and con.contype = 'f' and att.attname = 'created_by';

  if v_regla is null then
    raise exception 'no existe client_reports.created_by: la 0071 no esta aplicada';
  end if;
  if v_regla <> 'SET NULL' then
    raise exception 'created_by esta como %, y tiene que ser SET NULL: con CASCADE, dar de baja a un empleado borraria los informes que entrego', v_regla;
  end if;

  -- ── 2. Y SE COMPORTA COMO DICE ──────────────────────────────────────────────────────────────
  --
  -- Declararlo no alcanza: la restricción podría estar `not valid`, o haber quedado duplicada con
  -- otra que mande. Se prueba borrando de verdad.
  insert into public.profiles (id, clinic_id, full_name, role)
  values (v_autor, v_clinic, 'ZZZ verificacion 0071', 'vet');

  insert into public.client_reports (clinic_id, consultation_id, created_by, subject, body, channel)
  values (v_clinic, v_consulta, v_autor, 'ZZZ informe', 'ZZZ cuerpo', 'pdf')
  returning id into v_informe;

  delete from public.profiles where id = v_autor;

  select created_by into v_tras from public.client_reports where id = v_informe;
  if not found then
    raise exception 'el informe SE BORRO al borrar a quien lo entrego: la regla no es SET NULL en la practica';
  end if;
  if v_tras is not null then
    raise exception 'created_by quedo con valor tras borrar el perfil: %', v_tras;
  end if;

  -- ── 3. El canal está acotado ────────────────────────────────────────────────────────────────
  --
  -- Sin el check, un canal inventado entra y después nadie sabe por dónde se entregó ese informe.
  begin
    insert into public.client_reports (clinic_id, consultation_id, subject, body, channel)
    values (v_clinic, v_consulta, 'ZZZ canal', 'ZZZ', 'paloma_mensajera');
    raise exception 'un canal inventado ENTRO: falta el check de channel';
  exception
    when check_violation then null;
  end;

  -- ── 4. Y la tabla tiene RLS encendida ───────────────────────────────────────────────────────
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'client_reports';
  if v_n = 0 then
    raise exception 'client_reports no tiene policies: cualquier clinica veria los informes de otra';
  end if;

  raise exception '=== 0071 OK === created_by es SET NULL y lo cumple, el canal esta acotado, y hay % policies. Se revierte.', v_n;
end $$;

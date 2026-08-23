-- Verificación de la 0077 — la baja del correo.
--
-- LO QUE MÁS IMPORTA PROBAR es que la baja sea de una DIRECCIÓN y no de una persona: el correo va
-- en la clave primaria. Si la clave fuera `(clinic_id, owner_id)`, cambiarle el correo a la ficha
-- del titular arrastraría la baja a la dirección nueva —que puede ser de otra persona— y, peor,
-- volver a poner el correo viejo lo dejaría "suscrito" otra vez sin que nadie lo pidiera.
--
-- Y QUE NADIE PUEDA ESCRIBIR DESDE EL CLIENTE. La baja la escribe la página pública con
-- `service_role`; una policy de insert abierta dejaría que la propia clínica se diera de baja a sus
-- titulares —o los reactivara— desde el navegador.
--
-- ⚠️ LA RLS NO SE EJERCITA DESDE EL EDITOR: corre como `postgres`, que la saltea. Lo que se verifica
-- es la FORMA —qué policies hay y cuáles faltan a propósito— y queda dicho que eso es lo comprobado.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0077.

do $$
declare
  v_clinic uuid;
  v_owner  uuid;
  v_pk     text;
  v_n      int;
  v_tok    uuid;
  v_dup    int;
begin
  -- ── 1. El token existe en `owners`, es NOT NULL y es ÚNICO ──────────────────────────────────
  --
  -- Es la credencial de una página sin sesión. Dos titulares con el mismo token dejarían que uno
  -- diera de baja al otro; un token nulo deja al titular sin enlace y el correo saldría sin baja.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='owners'
       and column_name='unsubscribe_token' and is_nullable='NO'
  ) then
    raise exception 'falta owners.unsubscribe_token (o admite nulo): la 0077 no esta aplicada';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname='public' and tablename='owners' and indexdef ilike '%unique%unsubscribe_token%'
  ) then
    raise exception 'owners.unsubscribe_token no tiene indice UNICO: dos titulares podrian compartir credencial';
  end if;

  select count(*) into v_dup from (
    select unsubscribe_token from public.owners group by 1 having count(*) > 1
  ) t;
  if v_dup > 0 then
    raise exception 'hay % tokens repetidos en owners', v_dup;
  end if;

  -- ── 2. LA CLAVE INCLUYE EL CORREO ───────────────────────────────────────────────────────────
  select array_to_string(array_agg(att.attname::text order by att.attname::text), ',')
    into v_pk
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join unnest(con.conkey) k on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k
   where rel.relname = 'owner_email_optout' and con.contype = 'p';

  if v_pk is null then
    raise exception 'no existe owner_email_optout: la 0077 no esta aplicada';
  end if;
  if v_pk <> 'clinic_id,email,owner_id' then
    raise exception 'la clave primaria es (%) y tiene que incluir el correo: la baja es de una DIRECCION, no de una persona', v_pk;
  end if;

  -- ── 3. Y SE COMPORTA COMO DICE: dos correos del mismo titular son dos bajas ─────────────────
  select id into v_clinic from public.clinics order by created_at limit 1;
  select id, unsubscribe_token into v_owner, v_tok
    from public.owners where clinic_id = v_clinic order by created_at limit 1;
  if v_owner is null then
    raise exception 'hace falta una clinica con al menos un titular';
  end if;
  if v_tok is null then
    raise exception 'el titular quedo sin token: el default no corrio';
  end if;

  insert into public.owner_email_optout (clinic_id, owner_id, email, motivo)
  values (v_clinic, v_owner, 'zzz-verificacion-a@example.com', 'verificacion 0077');
  insert into public.owner_email_optout (clinic_id, owner_id, email, motivo)
  values (v_clinic, v_owner, 'zzz-verificacion-b@example.com', 'verificacion 0077');

  select count(*) into v_n from public.owner_email_optout
   where clinic_id = v_clinic and owner_id = v_owner and email like 'zzz-verificacion-%';
  if v_n <> 2 then
    raise exception 'se esperaban 2 bajas para el mismo titular y hay %: el correo no esta separando', v_n;
  end if;

  -- Y la misma dirección dos veces no duplica.
  begin
    insert into public.owner_email_optout (clinic_id, owner_id, email)
    values (v_clinic, v_owner, 'zzz-verificacion-a@example.com');
    raise exception 'la misma direccion entro dos veces: falta la clave primaria';
  exception
    when unique_violation then null;
  end;

  -- ── 4. La RLS está encendida, se puede LEER y NO se puede escribir desde el cliente ─────────
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='owner_email_optout' and c.relrowsecurity
  ) then
    raise exception 'la RLS esta APAGADA en owner_email_optout';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='owner_email_optout' and cmd='SELECT'
  ) then
    raise exception 'sin policy de SELECT, un administrador no puede ver por que encogio su audiencia';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname='public' and tablename='owner_email_optout' and cmd <> 'SELECT';
  if v_n > 0 then
    raise exception 'hay % policies de escritura: la baja la escribe la pagina publica con service_role, y "volver a suscribir" NO puede ser un boton del panel', v_n;
  end if;

  raise exception '=== 0077 OK === token unico y not null en owners, clave (clinic_id, owner_id, email) probada con dos correos del mismo titular, RLS on con SELECT y sin escritura desde el cliente. Se revierte.';
end $$;

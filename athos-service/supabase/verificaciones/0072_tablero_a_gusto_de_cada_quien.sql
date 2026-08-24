-- Verificación de la 0072 — cada quien arma su tablero.
--
-- LO QUE HAY QUE PROBAR ES QUE EL TABLERO DE UNO NO SEA EL DE OTRO. La preferencia se guarda por
-- `(user_id, clinic_id)` y la RLS la acota a `auth.uid()`. Si la clave primaria fuera sólo
-- `user_id`, un vet que trabaja en dos clínicas —que existe, `memberships` lo permite— tendría un
-- solo tablero para las dos; si la policy mirara `clinic_id` en vez de `user_id`, vería el de sus
-- compañeros.
--
-- ⚠️ LA RLS NO SE PUEDE EJERCITAR DESDE EL EDITOR: corre como `postgres`, que la saltea. Lo que sí
-- se verifica es que las policies EXISTAN y que comparen contra `auth.uid()` — que es donde estaría
-- el error si alguien las escribiera por clínica. Comprobar la forma es lo honesto acá; decir que
-- se probó el aislamiento sería mentir.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0072.

do $$
declare
  v_clinic  uuid;
  v_clinic2 uuid;
  v_perfil  uuid;
  v_pk      text;
  v_n       int;
  v_malas   text;
begin
  select id into v_clinic from public.clinics order by created_at limit 1;
  select id into v_perfil from public.profiles where clinic_id = v_clinic order by created_at limit 1;
  if v_perfil is null then
    raise exception 'hace falta una clinica con al menos un perfil';
  end if;

  -- ── 1. La clave primaria es (user_id, clinic_id) ────────────────────────────────────────────
  --
  -- Es lo que permite que la misma persona tenga un tablero distinto en cada clínica donde trabaja.
  select array_to_string(array_agg(att.attname::text order by att.attname::text), ',')
    into v_pk
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join unnest(con.conkey) k on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k
   where rel.relname = 'tablero_preferencias' and con.contype = 'p';

  if v_pk is null then
    raise exception 'no existe tablero_preferencias: la 0072 no esta aplicada';
  end if;
  if v_pk <> 'clinic_id,user_id' then
    raise exception 'la clave primaria es (%) y tiene que ser (user_id, clinic_id): con una sola columna, quien trabaja en dos clinicas tendria un solo tablero', v_pk;
  end if;

  -- ── 2. LA RLS ESTÁ ENCENDIDA ────────────────────────────────────────────────────────────────
  --
  -- Una tabla con policies pero sin `enable row level security` las tiene de adorno.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='tablero_preferencias' and c.relrowsecurity
  ) then
    raise exception 'tablero_preferencias tiene policies pero la RLS esta APAGADA: no filtran nada';
  end if;

  -- ── 3. Y TODAS comparan contra `auth.uid()`, no contra la clínica ───────────────────────────
  --
  -- Éste es el error que importa: una policy por `clinic_id` dejaría que cada quien vea —y pise—
  -- el tablero de sus compañeros, que es justo lo contrario de lo que se pidió.
  select count(*) into v_n from pg_policies
   where schemaname='public' and tablename='tablero_preferencias';
  if v_n < 4 then
    raise exception 'tablero_preferencias tiene solo % policies: faltan select/insert/update/delete', v_n;
  end if;

  select string_agg(policyname, ', ') into v_malas
    from pg_policies
   where schemaname='public' and tablename='tablero_preferencias'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%auth.uid()%';
  if v_malas is not null then
    raise exception 'estas policies no comparan contra auth.uid(): % — el tablero de uno seria el de todos', v_malas;
  end if;

  -- ── 4. Y la preferencia se guarda y se lee ──────────────────────────────────────────────────
  insert into public.tablero_preferencias (user_id, clinic_id, widgets)
  values (v_perfil, v_clinic, '[{"id":"zzz","visible":true}]'::jsonb)
  on conflict (user_id, clinic_id) do update set widgets = excluded.widgets;

  -- La MISMA persona en OTRA clínica: fila distinta, no un choque de clave.
  select id into v_clinic2 from public.clinics where id <> v_clinic order by created_at limit 1;
  if v_clinic2 is not null then
    insert into public.tablero_preferencias (user_id, clinic_id, widgets)
    values (v_perfil, v_clinic2, '[{"id":"zzz2","visible":false}]'::jsonb)
    on conflict (user_id, clinic_id) do update set widgets = excluded.widgets;
  end if;

  raise exception '=== 0072 OK === clave (user_id, clinic_id), RLS encendida, % policies todas por auth.uid(), y la misma persona tiene un tablero por clinica. Se revierte.', v_n;
end $$;

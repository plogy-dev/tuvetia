-- Verificación de la 0075 — el tablero con el que entra la clínica.
--
-- LO QUE HAY QUE PROBAR ES LA ASIMETRÍA, que es el punto entero de esta tabla: **todos** los de la
-- clínica pueden LEER el default —si no, no sería el punto de partida de nadie— y sólo un `admin`
-- puede ESCRIBIRLO. Con la escritura abierta, cualquiera cambiaría la pantalla de entrada de sus
-- compañeros; con la lectura cerrada, la tabla no sirve para nada.
--
-- ⚠️ LA RLS NO SE EJERCITA DESDE EL EDITOR: corre como `postgres`, que la saltea. Lo que se
-- verifica es la FORMA de las cuatro policies —cuál compara sólo por clínica y cuáles exigen
-- además el rol— y queda dicho que eso es lo comprobado. Decir que se probó el aislamiento sería
-- mentir.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0075.

do $$
declare
  v_clinic uuid;
  v_admin  uuid;
  v_regla  text;
  v_n      int;
  v_malas  text;
begin
  select id into v_clinic from public.clinics order by created_at limit 1;
  if v_clinic is null then
    raise exception 'hace falta al menos una clinica';
  end if;

  -- ── 1. La tabla existe, con la clínica como clave ───────────────────────────────────────────
  --
  -- UNA FILA POR CLÍNICA. Si la clave fuera compuesta o no hubiera clave, dos admins podrían
  -- dejar dos defaults distintos y el equipo entraría con uno u otro según el orden de lectura.
  if not exists (
    select 1 from pg_constraint con join pg_class rel on rel.oid = con.conrelid
     where rel.relname = 'tablero_default_clinica' and con.contype = 'p'
       and array_length(con.conkey, 1) = 1
  ) then
    raise exception 'tablero_default_clinica no existe o su clave primaria no es solo clinic_id: la 0075 no esta aplicada';
  end if;

  -- ── 2. `updated_by` es SET NULL ─────────────────────────────────────────────────────────────
  --
  -- Si fuera CASCADE, dar de baja al admin que lo configuro BORRARIA el tablero de entrada y la
  -- pantalla de todo el equipo cambiaria sola — por un motivo que nadie relacionaria con una baja
  -- de personal.
  select case con.confdeltype when 'n' then 'SET NULL' when 'c' then 'CASCADE'
                              when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
                              else con.confdeltype::text end
    into v_regla
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
   where rel.relname = 'tablero_default_clinica' and con.contype = 'f' and att.attname = 'updated_by';
  if v_regla is distinct from 'SET NULL' then
    raise exception 'updated_by esta como %, y tiene que ser SET NULL', coalesce(v_regla, '(sin FK)');
  end if;

  -- ── 3. La RLS está encendida ────────────────────────────────────────────────────────────────
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='tablero_default_clinica' and c.relrowsecurity
  ) then
    raise exception 'la RLS esta APAGADA: las policies son de adorno';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname='public' and tablename='tablero_default_clinica';
  if v_n <> 4 then
    raise exception 'hay % policies y tienen que ser 4 (select, insert, update, delete)', v_n;
  end if;

  -- ── 4. LA ASIMETRÍA: leer no exige rol, escribir sí ─────────────────────────────────────────
  --
  -- Si el SELECT exigiera `admin`, el default dejaria de ser el punto de partida de nadie mas que
  -- del admin — la tabla existiria y no serviria, que es la falla mas dificil de notar.
  if exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='tablero_default_clinica'
       and cmd = 'SELECT' and coalesce(qual,'') like '%my_role%'
  ) then
    raise exception 'la policy de SELECT exige rol: el default dejaria de verlo el equipo';
  end if;

  select string_agg(policyname, ', ') into v_malas
    from pg_policies
   where schemaname='public' and tablename='tablero_default_clinica'
     and cmd <> 'SELECT'
     and coalesce(qual,'') || coalesce(with_check,'') not like '%my_role%';
  if v_malas is not null then
    raise exception 'estas policies de escritura NO exigen rol admin: % — cualquiera cambiaria el tablero de entrada del equipo', v_malas;
  end if;

  -- ── 5. Y la fila se guarda y se lee ─────────────────────────────────────────────────────────
  select id into v_admin from public.profiles
   where clinic_id = v_clinic and role = 'admin' order by created_at limit 1;

  insert into public.tablero_default_clinica (clinic_id, widgets, updated_by)
  values (v_clinic, '[{"id":"metricas","visible":true}]'::jsonb, v_admin)
  on conflict (clinic_id) do update set widgets = excluded.widgets;

  if not exists (select 1 from public.tablero_default_clinica where clinic_id = v_clinic) then
    raise exception 'la fila no quedo';
  end if;

  raise exception '=== 0075 OK === una fila por clinica, updated_by SET NULL, RLS on con 4 policies: SELECT sin rol y las 3 de escritura exigiendo admin. Se revierte.';
end $$;

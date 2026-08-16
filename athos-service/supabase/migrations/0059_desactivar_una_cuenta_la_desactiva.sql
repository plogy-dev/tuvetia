-- Que "desactivar una cuenta" signifique algo.
--
-- EL DEFECTO. `profiles.is_active` existe desde el esquema base (`boolean not null default true`) y
-- `/admin/usuarios` ya la muestra. Pero NADIE la consulta: ni una policy de RLS, ni una función de
-- `private`, ni un RPC, ni el proxy de Next. Verificado sobre las policies del base, las migraciones
-- 0001–0058 y `src/proxy.ts`.
--
-- O sea que hoy poner `is_active = false` no le impide entrar a nadie. El acta del sync pide una
-- desactivación manual y otra automática por inactividad; construir esos botones sobre esta columna
-- sería construir botones que no desactivan.
--
-- ── 1. Dónde se pone el gate ────────────────────────────────────────────────────────────────────
--
-- En `private.my_clinic_id()`, que es de donde cuelga TODA la RLS del producto: cada policy por
-- clínica compara contra ella. Un perfil inactivo devuelve NULL y deja de ver los datos de su
-- clínica sin tocar una sola policy — que además es lo que hace este cambio auditable: hay un solo
-- lugar donde mirar.
--
-- `private.my_role()` se gatea igual. Hoy no hace falta —ninguna policy la usa sin `my_clinic_id()`,
-- y los RPCs de invitación y equipo cortan antes con `if v_clinic_id is null then raise`— pero es
-- una línea, y deja cerrado el día que alguien escriba una policy que sólo mire el rol.
--
-- ── 2. `profiles_select`: acá el repo estaba DESACTUALIZADO respecto de la base ─────────────────
--
-- El gate necesita que uno pueda leer siempre su propia fila. Si no, un usuario desactivado tampoco
-- puede leer SU PROPIO PERFIL, la app no lo encuentra y lo trata como alguien sin clínica:
-- `dashboard/layout.tsx` lo manda a `/bienvenida` y ahí le pinta «Sin clínica», ofreciéndole empezar
-- de cero. Un veterinario al que le desactivaron la cuenta leería «no tienes clínica» y creería que
-- sus datos se perdieron — peor que no tener gate.
--
-- LO QUE ENCONTRAMOS AL VERIFICARLO CONTRA EL PRINCIPAL (15-ago, consulta de sólo lectura):
--
--     profiles_select → ((clinic_id = private.my_clinic_id()) OR (id = auth.uid()))
--
-- O sea que **la base ya lo tiene y el repo no**: el `000_base_schema.sql` declara sólo
-- `clinic_id = private.my_clinic_id()`, y ninguna migración de la 0001 a la 0058 agrega el
-- `id = auth.uid()`. Alguien lo cambió directo en la base. Es drift del mismo tipo que auditó
-- `docs/ESTADO-PLATAFORMA-2026-07-28.md`.
--
-- Por eso este bloque **no cambia el principal**: lo deja escrito. Sirve para que dev y el repo
-- digan lo mismo que producción, que es la condición para que la próxima migración sea predecible.
-- Sin él, el gate funcionaría en el principal y rompería en dev, que es la peor combinación posible.
--
-- ── 3. Por qué es seguro ────────────────────────────────────────────────────────────────────────
--
-- `is_active` es `not null default true`. Verificado contra el principal el 15-ago: **17 perfiles,
-- 0 desactivados**, columna NOT NULL con default `true`. O sea que el día que esto se aplique NO
-- cambia el comportamiento de ninguna persona — el gate queda armado y sin nadie adentro, que es
-- exactamente como se quiere desplegar algo que corta accesos.
--
-- Y `id = auth.uid()` sólo agrega tu propia fila a lo que ya podías ver: no abre nada de otra
-- clínica.
--
-- Las dos funciones son `security definer`, así que leen `profiles` sin pasar por RLS: no hay
-- recursión con la policy que se redefine abajo.

-- ── El gate ─────────────────────────────────────────────────────────────────────────────────────

create or replace function private.my_clinic_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select clinic_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function private.my_role()
returns public.user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

-- ── Poder leerse a uno mismo, siempre ───────────────────────────────────────────────────────────

-- `ALTER POLICY` y NO `drop` + `create`, que es lo que decía la primera versión de este archivo.
--
-- Drop y create son DOS sentencias, y `psql -f` sin `-1` las corre en autocommit: entre una y otra
-- queda una ventana —corta, pero real— con RLS habilitada y SIN policy de lectura sobre `profiles`,
-- o sea con todas las lecturas denegadas. En una tabla que la app consulta en cada carga de página,
-- esa ventana son errores para quien esté usando el producto en ese instante.
--
-- `ALTER POLICY` es una sola sentencia atómica: no hay instante intermedio, se aplique como se
-- aplique. El `DO` es sólo para cubrir el caso de que la policy no exista (una base recién
-- bootstrapeada), donde hay que crearla.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select'
  ) then
    execute $q$
      alter policy "profiles_select" on public.profiles
        using (id = auth.uid() or clinic_id = private.my_clinic_id())
    $q$;
  else
    execute $q$
      create policy "profiles_select" on public.profiles
        for select using (id = auth.uid() or clinic_id = private.my_clinic_id())
    $q$;
  end if;
end $$;

comment on function private.my_clinic_id() is
  'La clínica del usuario actual, o NULL si su perfil está inactivo. Es el gate de la desactivación '
  'de cuentas: toda la RLS por clínica cuelga de acá.';

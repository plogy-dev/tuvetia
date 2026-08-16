-- Verificación de la migración 0062. Se pega entera en el SQL Editor del principal DESPUÉS de
-- aplicarla. No escribe nada: sólo lee el catálogo.
--
-- Si todo está bien, termina con "=== 0062 OK ===". Cualquier otro mensaje es un problema real y
-- dice cuál.

do $$
declare
  n int;
begin
  -- ── 1. La tabla existe y tiene RLS ──────────────────────────────────────────────────────────
  if to_regclass('public.clinic_briefings') is null then
    raise exception 'Falta la tabla clinic_briefings';
  end if;

  select count(*) into n
  from pg_class where oid = 'public.clinic_briefings'::regclass and relrowsecurity;
  if n = 0 then
    raise exception 'clinic_briefings existe pero SIN row level security';
  end if;

  -- ── 2. La unicidad por día, que es la guarda contra el doble gasto ──────────────────────────
  -- Sin ella, dos disparos del mismo día redactan —y cobran— dos briefings.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinic_briefings'::regclass
      and contype = 'u'
      and conname = 'clinic_briefings_unicos_por_dia'
  ) then
    raise exception 'Falta la restriccion unique (clinic_id, fecha): un segundo barrido cobraria de nuevo';
  end if;

  -- ── 3. Se lee por clínica, y NO se escribe desde la sesión ──────────────────────────────────
  -- El briefing lo escribe el cron con service_role. Un veterinario no tiene por que poder
  -- fabricarse un resumen del dia.
  select count(*) into n
  from pg_policies where schemaname = 'public' and tablename = 'clinic_briefings';
  if n <> 1 then
    raise exception 'clinic_briefings deberia tener EXACTAMENTE 1 policy (select); tiene %', n;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinic_briefings'
      and cmd = 'SELECT' and qual ~ 'my_clinic_id'
  ) then
    raise exception 'La policy de clinic_briefings no acota por clinica';
  end if;

  -- Y la que sí existe usa el subselect, como pide el linter (ver migración 0061).
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinic_briefings'
      and qual ~ 'my_clinic_id' and qual !~ '\(\s*SELECT'
  ) then
    raise exception 'La policy de clinic_briefings reevalua my_clinic_id por fila';
  end if;

  -- ── 4. El interruptor ───────────────────────────────────────────────────────────────────────
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinics' and column_name = 'briefing_enabled'
  ) then
    raise exception 'Falta clinics.briefing_enabled';
  end if;

  -- ── 5. La superficie de costo ───────────────────────────────────────────────────────────────
  -- Sin esto el INSERT del consumo choca contra el check y el gasto del briefing queda SIN
  -- registrar — invisible en /admin/costos, que es justo donde tiene que verse.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.athos_agent_usage'::regclass
      and conname = 'athos_agent_usage_surface_check'
      and pg_get_constraintdef(oid) like '%briefing%'
  ) then
    raise exception 'athos_agent_usage no acepta la superficie "briefing": el gasto quedaria sin registrar';
  end if;

  raise exception '=== 0062 OK === tabla, unicidad, 1 policy de lectura, interruptor y superficie de costo';
end $$;

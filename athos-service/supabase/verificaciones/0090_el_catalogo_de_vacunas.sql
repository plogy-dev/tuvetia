-- Verificación de la 0090 — el catálogo de vacunas.
--
-- Lo que más importa: que el índice de nombre normalizado MUERDA («Rabia» vs «rabia » es el bug
-- que este catálogo viene a matar, y si el índice no lo frena, el catálogo lo replica), y que la
-- tabla quede con RLS. Todo se revierte con el raise final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0090.

do $$
declare
  v_clinic uuid;
  v_ok     boolean;
begin
  insert into public.clinics (name, plan, subscription_status)
       values ('VERIFICACION 0090', 'pro', 'active') returning id into v_clinic;

  -- ── 1. SE PUEDE ARMAR EL CATALOGO ───────────────────────────────────────────────────────────
  insert into public.vaccine_types (clinic_id, name, species) values
    (v_clinic, 'Rabia', null),
    (v_clinic, 'Triple felina', 'Gato');
  raise notice '1 OK — catalogo con dos vacunas';

  -- ── 2. EL NOMBRE NORMALIZADO NO SE REPITE ───────────────────────────────────────────────────
  v_ok := false;
  begin
    insert into public.vaccine_types (clinic_id, name) values (v_clinic, '  rabia ');
  exception when unique_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 2 — "rabia " entro como vacuna distinta de "Rabia"';
  end if;
  raise notice '2 OK — el indice normalizado muerde';

  -- ── 3. EL NOMBRE VACIO NO ENTRA ─────────────────────────────────────────────────────────────
  v_ok := false;
  begin
    insert into public.vaccine_types (clinic_id, name) values (v_clinic, '   ');
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLA 3 — entro una vacuna sin nombre';
  end if;
  raise notice '3 OK — sin nombres vacios';

  -- ── 4. RLS ──────────────────────────────────────────────────────────────────────────────────
  if not (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'vaccine_types') then
    raise exception 'FALLA 4 — vaccine_types quedo sin RLS';
  end if;
  raise notice '4 OK — RLS activa';

  raise exception 'VERIFICACION 0090 OK — todo revertido a proposito';
end $$;

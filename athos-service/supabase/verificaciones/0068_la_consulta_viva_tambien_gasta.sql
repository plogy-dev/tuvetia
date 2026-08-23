-- Verificación de la 0068 — `consulta_viva` entra en el contador de gasto.
--
-- EJERCITA EL CHECK, no lo lee. Un `alter table … add constraint` que corrió sobre una restricción
-- que ya no existía con ese nombre no falla: no hace nada, y el catálogo puede seguir mostrando la
-- vieja. Insertar una fila con la superficie nueva es lo único que distingue "se aplicó" de "se
-- ejecutó sin error".
--
-- Y COMPRUEBA LAS DOS MITADES. Que `consulta_viva` entre es la obvia; que una superficie inventada
-- SIGA siendo rechazada es la que evita cambiar un check por ninguno — un `drop constraint` sin su
-- `add` deja la tabla aceptando cualquier cosa, y el síntoma sería un contador de gasto que suma
-- filas de un origen que nadie escribió.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0068.

do $$
declare
  v_clinic uuid;
  v_fallo  text;
  v_n      int;
begin
  select id into v_clinic from public.clinics order by created_at limit 1;
  if v_clinic is null then
    raise exception 'hace falta al menos una clinica';
  end if;

  -- ── 1. La superficie NUEVA entra ────────────────────────────────────────────────────────────
  insert into public.athos_agent_usage (clinic_id, surface, model, input_tokens, output_tokens)
  values (v_clinic, 'consulta_viva', 'zzz-verificacion', 1, 1);

  select count(*) into v_n
    from public.athos_agent_usage
   where clinic_id = v_clinic and model = 'zzz-verificacion' and surface = 'consulta_viva';
  if v_n <> 1 then
    raise exception 'la fila de consulta_viva no quedo: el check no admite la superficie nueva';
  end if;

  -- ── 2. Las que ya existían siguen entrando ──────────────────────────────────────────────────
  --
  -- El `drop` + `add` reescribe la lista entera. Si alguien la copia mal y se come una, la
  -- superficie perdida deja de contabilizarse y el gasto de esa función se vuelve invisible.
  insert into public.athos_agent_usage (clinic_id, surface, model, input_tokens, output_tokens)
  values (v_clinic, 'agent', 'zzz-verificacion', 1, 1),
         (v_clinic, 'auto_reply', 'zzz-verificacion', 1, 1),
         (v_clinic, 'briefing', 'zzz-verificacion', 1, 1),
         (v_clinic, 'widget', 'zzz-verificacion', 1, 1),
         (v_clinic, 'cartera_inbound', 'zzz-verificacion', 1, 1),
         (v_clinic, 'suggest_reply', 'zzz-verificacion', 1, 1),
         (v_clinic, 'vision_recipe', 'zzz-verificacion', 1, 1),
         (v_clinic, 'vision_purchase', 'zzz-verificacion', 1, 1);

  -- ── 3. UNA INVENTADA SIGUE RECHAZÁNDOSE ─────────────────────────────────────────────────────
  --
  -- La mitad que evita cambiar un check por ninguno.
  begin
    insert into public.athos_agent_usage (clinic_id, surface, model, input_tokens, output_tokens)
    values (v_clinic, 'zzz_superficie_que_no_existe', 'zzz-verificacion', 1, 1);
    raise exception 'una superficie inventada ENTRO: el check quedo caido, no acotado';
  exception
    when check_violation then null;   -- lo esperado
  end;

  select count(*) into v_n
    from public.athos_agent_usage where model = 'zzz-verificacion';

  raise exception '=== 0068 OK === consulta_viva admitida, las 8 anteriores intactas y una inventada rechazada (% filas de prueba, se revierten)', v_n;
end $$;

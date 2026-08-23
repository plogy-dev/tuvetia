-- Verificación de la 0078 — la prueba de tres días.
--
-- LO QUE MÁS IMPORTA PROBAR no es que la prueba se dé, sino que NO SE PISE un alta deliberada. El
-- trigger corre en TODA inserción de clínica, incluidas las que hace una migración, un traspaso o
-- el panel de admin. Si no respetara la fila que ya viene con plan, un alta de Pro pagada se
-- convertiría en una prueba de tres días y se caería sola el jueves.
--
-- Lo segundo es que las tres columnas se muevan JUNTAS: Pro sin `plan_renueva_en` es Pro para
-- siempre, y es el error que un default habría producido.
--
-- Y lo tercero, que la clínica que hoy está en `free` con `subscription_status = 'trial'` por el
-- default histórico siga sin acceso: el gate lee `plan`, no el estado.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0078.

do $$
declare
  v_nueva      uuid;
  v_deliberada uuid;
  v_con_fecha  uuid;
  v_plan       text;
  v_estado     text;
  v_renueva    timestamptz;
  v_dias       numeric;
  v_legacy     int;
begin
  -- ── 1. Una clínica nueva nace con la prueba puesta ──────────────────────────────────────────
  insert into public.clinics (name) values ('VERIFICACION 0078 nueva') returning id into v_nueva;

  select plan, subscription_status, plan_renueva_en
    into v_plan, v_estado, v_renueva
    from public.clinics where id = v_nueva;

  if v_plan is distinct from 'pro' then
    raise exception 'FALLA: una clínica nueva nació con plan=% en vez de pro', v_plan;
  end if;
  if v_estado is distinct from 'trial' then
    raise exception 'FALLA: una clínica nueva nació con estado=% en vez de trial', v_estado;
  end if;
  if v_renueva is null then
    raise exception 'FALLA: Pro sin plan_renueva_en es Pro para siempre — el barrido no la vería';
  end if;

  -- ── 2. Son TRES días, no otra cosa ──────────────────────────────────────────────────────────
  v_dias := extract(epoch from (v_renueva - now())) / 86400;
  if v_dias < 2.9 or v_dias > 3.1 then
    raise exception 'FALLA: la prueba dura % días, se esperaban 3', round(v_dias, 2);
  end if;

  -- ── 3. NO se pisa un alta deliberada de Pro ─────────────────────────────────────────────────
  -- El caso que rompe plata: alguien da de alta una clínica ya paga y el trigger la degrada a una
  -- prueba que vence en tres días.
  insert into public.clinics (name, plan, subscription_status)
       values ('VERIFICACION 0078 deliberada', 'pro', 'active')
    returning id into v_deliberada;

  select plan, subscription_status, plan_renueva_en
    into v_plan, v_estado, v_renueva
    from public.clinics where id = v_deliberada;

  if v_estado is distinct from 'active' then
    raise exception 'FALLA: el trigger pisó un alta deliberada (estado quedó %)', v_estado;
  end if;
  if v_renueva is not null then
    raise exception 'FALLA: el trigger le puso vencimiento de prueba a un alta deliberada';
  end if;

  -- ── 4. Tampoco se pisa una fila que ya trae su propio reloj ─────────────────────────────────
  insert into public.clinics (name, plan_renueva_en)
       values ('VERIFICACION 0078 con fecha', now() + interval '30 days')
    returning id into v_con_fecha;

  select plan, plan_renueva_en into v_plan, v_renueva
    from public.clinics where id = v_con_fecha;

  if v_plan is distinct from 'free' then
    raise exception 'FALLA: una fila que ya traía plan_renueva_en fue convertida en prueba';
  end if;
  if extract(epoch from (v_renueva - now())) / 86400 < 29 then
    raise exception 'FALLA: se pisó el plan_renueva_en que venía en la fila';
  end if;

  -- ── 5. La clínica vieja en free+trial sigue SIN acceso ──────────────────────────────────────
  -- El gate lee `plan`. Que su estado diga 'trial' por el default histórico no le da nada, y el
  -- barrido no la ve porque su plan_renueva_en es null.
  --
  -- SE EXCLUYEN LAS TRES FILAS DE ESTA VERIFICACIÓN, y no es cosmético: `subscription_status` tiene
  -- default `'trial'`, así que la del caso 4 —insertada con `plan_renueva_en` y sin plan— ES una
  -- fila free+trial+fecha. La primera versión de este check no las excluía, se contaba a sí mismo y
  -- fallaba siempre. Lo descubrió la corrida real del 23-ago contra el principal.
  select count(*) into v_legacy
    from public.clinics
   where subscription_status = 'trial'
     and plan = 'free'
     and plan_renueva_en is not null
     and id not in (v_nueva, v_deliberada, v_con_fecha);

  if v_legacy > 0 then
    raise exception 'FALLA: hay % clínica(s) en free+trial CON fecha — el barrido las tocaría', v_legacy;
  end if;

  raise exception 'VERIFICACION 0078 OK — los 5 casos pasaron. Todo revertido.';
end $$;

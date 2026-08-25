-- Verificación de la 0084 — el nombre de quien escribe.
--
-- LO QUE MÁS IMPORTA PROBAR es que los mensajes que YA EXISTEN sigan entrando sin el campo: son
-- 3.491 salientes y 4.160 entrantes en el principal, y un NOT NULL por descuido rompería el webhook
-- entero — o sea, dejaría de llegar TODO mensaje de WhatsApp.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0084.

do $$
declare
  v_clinic uuid;
  v_msg    uuid;
  v_valor  text;
begin
  insert into public.clinics (name, plan, subscription_status)
       values ('VERIFICACION 0084', 'pro', 'active') returning id into v_clinic;

  -- ── 1. SIN NOMBRE DE PERFIL: tiene que entrar igual ─────────────────────────────────────────
  insert into public.whatsapp_messages
         (clinic_id, wa_message_id, wa_phone_from, wa_phone_to, direction, body)
       values (v_clinic, 'VERIF-0084-A', '573001112222', '573009998888', 'inbound', 'hola')
    returning id into v_msg;
  select push_name into v_valor from public.whatsapp_messages where id = v_msg;
  if v_valor is not null then
    raise exception 'FALLA 1 — push_name no arranca vacío';
  end if;
  raise notice '1 OK — un mensaje sin nombre de perfil entra igual';

  -- ── 2. CON NOMBRE DE PERFIL ─────────────────────────────────────────────────────────────────
  update public.whatsapp_messages set push_name = 'Juan Pérez' where id = v_msg;
  select push_name into v_valor from public.whatsapp_messages where id = v_msg;
  if v_valor is distinct from 'Juan Pérez' then
    raise exception 'FALLA 2 — no se guardó el nombre de perfil';
  end if;
  raise notice '2 OK — el nombre de perfil se guarda';

  -- ── 3. ACEPTA EMOJI Y TEXTO RARO ────────────────────────────────────────────────────────────
  -- No es capricho: el nombre lo elige quien escribe y en la práctica llegan emojis y símbolos.
  update public.whatsapp_messages set push_name = '🐶 Casa de Milo ✨' where id = v_msg;
  select push_name into v_valor from public.whatsapp_messages where id = v_msg;
  if v_valor is distinct from '🐶 Casa de Milo ✨' then
    raise exception 'FALLA 3 — no aguantó emoji';
  end if;
  raise notice '3 OK — aguanta emoji';

  -- ── 4. LA COLUMNA EXISTE Y ES TEXT ──────────────────────────────────────────────────────────
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'whatsapp_messages'
      and column_name = 'push_name' and data_type = 'text';
  if not found then
    raise exception 'FALLA 4 — push_name no existe o no es text';
  end if;
  raise notice '4 OK — la columna existe';

  raise exception 'VERIFICACION 0084 OK — todo revertido a propósito';
end $$;

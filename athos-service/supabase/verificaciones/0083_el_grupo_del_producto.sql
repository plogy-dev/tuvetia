-- Verificación de la 0083 — el grupo del producto.
--
-- LO QUE MÁS IMPORTA PROBAR es que los ítems que YA EXISTEN sigan entrando sin grupo: la columna es
-- opcional y la inmensa mayoría del catálogo de cualquier clínica no va a tener uno. Un `NOT NULL`
-- por descuido rompería la creación de todo producto nuevo.
--
-- Después: que se pueda escribir y volver a vaciar, y que el índice esté puesto.
--
-- Todo se deshace con el `raise exception` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0083.

do $$
declare
  v_clinic uuid;
  v_item   uuid;
  v_valor  text;
begin
  insert into public.clinics (name, plan, subscription_status)
       values ('VERIFICACION 0083', 'pro', 'active') returning id into v_clinic;

  -- ── 1. SIN GRUPO: el caso de todos los días ─────────────────────────────────────────────────
  insert into public.catalog_items (clinic_id, item_type, name, price_cents)
       values (v_clinic, 'SERVICIO', 'Consulta general', 8000000)
    returning id into v_item;
  select item_group into v_valor from public.catalog_items where id = v_item;
  if v_valor is not null then
    raise exception 'FALLA 1 — el grupo no arranca vacío';
  end if;
  raise notice '1 OK — un producto sin grupo entra igual';

  -- ── 2. CON GRUPO ────────────────────────────────────────────────────────────────────────────
  update public.catalog_items set item_group = 'Medicamentos' where id = v_item;
  select item_group into v_valor from public.catalog_items where id = v_item;
  if v_valor is distinct from 'Medicamentos' then
    raise exception 'FALLA 2 — no se guardó el grupo';
  end if;
  raise notice '2 OK — el grupo se guarda';

  -- ── 3. SE PUEDE VACIAR ──────────────────────────────────────────────────────────────────────
  -- Quitarle el grupo a un producto tiene que devolverlo a «sin grupo», no dejar cadena vacía.
  update public.catalog_items set item_group = null where id = v_item;
  select item_group into v_valor from public.catalog_items where id = v_item;
  if v_valor is not null then
    raise exception 'FALLA 3 — no se pudo quitar el grupo';
  end if;
  raise notice '3 OK — el grupo se puede quitar';

  -- ── 4. LA COLUMNA Y EL ÍNDICE EXISTEN ───────────────────────────────────────────────────────
  perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'catalog_items'
      and column_name = 'item_group' and data_type = 'text';
  if not found then
    raise exception 'FALLA 4 — item_group no existe o no es text';
  end if;
  perform 1 from pg_indexes
    where schemaname = 'public' and tablename = 'catalog_items'
      and indexname = 'catalog_items_clinic_group_idx';
  if not found then
    raise exception 'FALLA 4 — falta el índice de grupo';
  end if;
  raise notice '4 OK — columna e índice puestos';

  -- Deshace TODO lo de arriba.
  raise exception 'VERIFICACION 0083 OK — todo revertido a propósito';
end $$;

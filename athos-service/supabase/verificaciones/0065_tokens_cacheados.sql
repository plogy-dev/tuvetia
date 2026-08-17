-- Verificación de la 0065 — el desglose de caché en `athos_agent_usage`.
--
-- No se limita a comprobar que las columnas existan: **escribe una fila** con los tres valores y la
-- lee, porque una columna que existe pero rechaza lo que el código le va a mandar es el mismo fallo
-- con otra forma. Todo se deshace con el `raise` final.
--
-- Se corre en el editor SQL del principal, después de aplicar la 0065.

do $$
declare
  v_clinic uuid;
  v_id     uuid;
  v_fila   public.athos_agent_usage%rowtype;
  v_n      int;
begin
  -- ── 1. Las dos columnas, con el tipo correcto y aceptando null ──────────────────────────────
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'athos_agent_usage'
    and column_name in ('tokens_cache_read', 'tokens_cache_write')
    and data_type    = 'integer'
    and is_nullable  = 'YES';
  if v_n <> 2 then
    raise exception 'se esperaban 2 columnas integer nullable de cache y hay %', v_n;
  end if;

  -- ── 2. Con su comentario: es donde vive la advertencia de que van INCLUIDAS en tokens_in ────
  select count(*) into v_n
  from information_schema.columns c
  join pg_class t on t.relname = c.table_name
  where c.table_schema = 'public' and c.table_name = 'athos_agent_usage'
    and c.column_name in ('tokens_cache_read', 'tokens_cache_write')
    and col_description(t.oid, c.ordinal_position) is not null;
  if v_n <> 2 then
    raise exception 'las columnas de cache quedaron sin comentario: se pierde la nota de que van incluidas en tokens_in';
  end if;

  -- ── 3. ESCRIBE Y LEE, que es lo que de verdad prueba que sirve ─────────────────────────────
  select id into v_clinic from public.clinics order by created_at limit 1;
  if v_clinic is null then
    raise exception 'no hay ninguna clinica con la que ejercitar el insert';
  end if;

  insert into public.athos_agent_usage
    (clinic_id, surface, provider, model, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write)
  values
    (v_clinic, 'agent', 'anthropic', 'zzz-verificacion-0065', 32588, 774, 30000, 2588)
  returning id into v_id;

  select * into v_fila from public.athos_agent_usage where id = v_id;
  if v_fila.tokens_cache_read <> 30000 or v_fila.tokens_cache_write <> 2588 then
    raise exception 'la fila no conservo el desglose: read=% write=%',
      v_fila.tokens_cache_read, v_fila.tokens_cache_write;
  end if;

  -- El desglose nunca puede superar al total: si lo hace, alguien lo esta sumando aparte en vez de
  -- leerlo como parte de tokens_in.
  if coalesce(v_fila.tokens_cache_read,0) + coalesce(v_fila.tokens_cache_write,0) > v_fila.tokens_in then
    raise exception 'el desglose de cache supera tokens_in, que el SDK define como el TOTAL';
  end if;

  -- ── 4. Null sigue siendo valido: significa "el proveedor no lo reporto" ────────────────────
  insert into public.athos_agent_usage (clinic_id, surface, provider, model, tokens_in, tokens_out)
  values (v_clinic, 'agent', 'deepseek', 'zzz-verificacion-0065-sin-cache', 100, 10);

  raise exception '=== 0065 OK === dos columnas integer nullable, con comentario, y una fila escrita y leida con su desglose';
end $$;

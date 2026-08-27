-- 0098: que dar de baja una clínica pueda terminar.
--
-- ── EL DEFECTO ──────────────────────────────────────────────────────────────────────────────────
--
-- Auditoría del 27-ago, hallazgo 1 (alto). `delete from public.clinics where id = X` falla con
-- violación de clave foránea en cuanto la clínica haya tenido un titular, un paciente, una consulta
-- o una cita. O sea, siempre.
--
-- La cadena, verificada contra el principal:
--
--   · De las 61 claves foráneas que apuntan a `clinics`, 60 son `on delete cascade` y UNA no:
--     `audit_logs_clinic_id_fkey` es `no action`, que bloquea.
--   · La 0063 puso triggers AFTER DELETE en `appointments`, `consultations`, `owners` y `patients`
--     (`*_traza`), todos sobre `private.registrar_cambio()`.
--   · En su rama de DELETE, esa función INSERTA en `audit_logs` con el `clinic_id` de la fila que
--     se acaba de borrar.
--   · Entonces el propio cascade genera las filas que impiden que el cascade termine.
--
-- Consecuencia ya medida: el teardown de `athos-service/tests/conftest.py` hace exactamente ese
-- delete sobre dos clínicas que su fixture acaba de poblar. No vuelve en cero, vuelve con error, y
-- las clínicas de prueba se acumulan en la base de desarrollo.
--
-- ── LOS DOS CAMBIOS, QUE VAN JUNTOS ─────────────────────────────────────────────────────────────
--
-- 1. La traza NO se escribe si la clínica ya no existe.
-- 2. Con eso, `audit_logs` puede pasar a cascadear.
--
-- Ninguno de los dos sirve solo: sin (1), el cascade de (2) borra las filas viejas y el trigger
-- inserta unas nuevas que vuelven a bloquear.
--
-- ── HASTA DÓNDE LLEGA ESTO, DICHO CLARO ─────────────────────────────────────────────────────────
--
-- Esto NO hace que `delete from clinics` funcione para toda clínica. Quedan NUEVE cadenas
-- `restrict` en facturación y planes de salud —`credit_notes.invoice_id`,
-- `fiscal_documents.invoice_id`, `payment_applications.invoice_id`, `invoices.payer_id`,
-- `invoices.numbering_range_id`, `purchase_items.catalog_item_id`,
-- `health_plan_items.catalog_item_id`, `health_plan_uses.catalog_item_id`,
-- `patient_health_plans.plan_id`— y `restrict` se evalúa de inmediato en vez de diferirse al fin
-- del statement, así que le gana a cualquier cascade del mismo comando.
--
-- Lo que esta migración arregla es la clínica SIN facturación, que es el caso de las pruebas y el
-- de un cliente que se dio de baja antes de emitir. Una clínica con facturas sigue necesitando
-- `athos-service/supabase/mantenimiento/borrar_una_clinica.sql`, que borra hoja→raíz en el orden
-- que impone el grafo real de claves foráneas.

-- ── 1 · La guarda en la traza ───────────────────────────────────────────────────────────────────
--
-- Se redeclara la función ENTERA porque plpgsql no admite parches; el cuerpo es el de la 0063 con
-- ocho líneas nuevas al principio de la rama de DELETE. Todo lo demás —la comparación campo a
-- campo, el salto de `updated_at`, el UPDATE que no cambió nada— queda igual.
--
-- POR QUÉ LA GUARDA ES CORRECTA Y NO UN PARCHE. En un cascade, Postgres borra la fila padre PRIMERO
-- y después propaga a las hijas. Así que cuando el AFTER DELETE de `owners` corre por un
-- `delete from clinics`, la clínica ya no está. Auditar el borrado de una clínica que no existe no
-- es información que alguien vaya a leer: la clínica se fue, y con ella todo lo que la traza
-- describía. La guarda no esconde nada — sólo deja de escribir una fila que nadie puede consultar
-- y que además traba el borrado.
--
-- Y NO afecta al borrado normal: dar de baja UN titular deja la clínica en su lugar, la guarda no
-- se dispara, y la traza se escribe como siempre. Es la diferencia entre borrar algo DE una clínica
-- y borrar la clínica.

create or replace function private.registrar_cambio()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_antes   jsonb;
  v_despues jsonb;
  v_cambios jsonb := '{}'::jsonb;
  v_clave   text;
  v_clinica uuid;
begin
  if tg_op = 'DELETE' then
    v_antes := to_jsonb(old);
    v_clinica := (v_antes ->> 'clinic_id')::uuid;

    -- LA GUARDA. Si la clínica ya no existe, esto es el cascade de un `delete from clinics`: la
    -- fila de traza que escribiríamos apunta a una clínica que se está yendo, y su clave foránea
    -- aborta el borrado entero. Se sale sin escribir.
    if v_clinica is not null and not exists (
      select 1 from public.clinics where id = v_clinica
    ) then
      return old;
    end if;

    insert into public.audit_logs (clinic_id, user_id, action, table_name, record_id, payload)
    values (
      v_clinica,
      auth.uid(),
      tg_table_name || '.deleted',
      tg_table_name,
      (v_antes ->> 'id')::uuid,
      -- La fila ENTERA: ya no existe en ningún otro lado, así que el payload es todo lo que queda.
      jsonb_build_object('fila', v_antes)
    );
    return old;
  end if;

  v_antes   := to_jsonb(old);
  v_despues := to_jsonb(new);

  -- Sólo los campos que cambiaron de verdad. Guardar la fila entera en cada edición duplicaría el
  -- dato y obligaría a comparar a mano para saber qué se tocó, que es justo lo que se quiere evitar.
  for v_clave in select jsonb_object_keys(v_despues)
  loop
    -- `updated_at` cambia SIEMPRE: incluirlo haría que ninguna edición pareciera vacía y llenaría la
    -- traza de filas que no dicen nada.
    continue when v_clave = 'updated_at';
    if (v_antes -> v_clave) is distinct from (v_despues -> v_clave) then
      v_cambios := v_cambios || jsonb_build_object(
        v_clave,
        jsonb_build_object('antes', v_antes -> v_clave, 'despues', v_despues -> v_clave)
      );
    end if;
  end loop;

  -- Un UPDATE que no cambió nada observable no se registra. Pasa más de lo que parece: un formulario
  -- que se guarda sin tocar nada dispara el UPDATE igual.
  if v_cambios = '{}'::jsonb then
    return new;
  end if;

  insert into public.audit_logs (clinic_id, user_id, action, table_name, record_id, payload)
  values (
    (v_despues ->> 'clinic_id')::uuid,
    auth.uid(),
    tg_table_name || '.updated',
    tg_table_name,
    (v_despues ->> 'id')::uuid,
    jsonb_build_object('cambios', v_cambios)
  );
  return new;
end;
$function$;

-- ── 2 · La clave foránea que quedaba bloqueando ─────────────────────────────────────────────────
--
-- Era la única de las 61 sin `on delete cascade`. Con la guarda de arriba ya no se insertan filas
-- nuevas durante el borrado, así que el cascade puede llevarse las viejas y terminar.
--
-- ¿ESTÁ BIEN QUE LA TRAZA DE UNA CLÍNICA SE VAYA CON ELLA? Sí, y no es una concesión. La traza
-- registra quién tocó qué DENTRO de esa clínica; borrada la clínica, todo lo que describía se fue
-- por los otros sesenta cascades. Lo que quedaría es una lista de identificadores que ya no
-- resuelven a nada, inalcanzable desde cualquier pantalla —`/admin` filtra por clínica— y con datos
-- personales de titulares dentro del `payload`. Conservarla no es auditoría: es un residuo con
-- información personal de un cliente que pidió irse.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'audit_logs_clinic_id_fkey' and confdeltype <> 'c'
  ) then
    alter table public.audit_logs drop constraint audit_logs_clinic_id_fkey;
    alter table public.audit_logs
      add constraint audit_logs_clinic_id_fkey
      foreign key (clinic_id) references public.clinics(id) on delete cascade;
  end if;
end
$$;

-- El índice que ese cascade necesita para no recorrer la tabla entera en cada baja. `audit_logs`
-- crece con cada edición de cada clínica, así que es la que más rápido lo va a necesitar.
create index if not exists audit_logs_clinic_idx on public.audit_logs (clinic_id);

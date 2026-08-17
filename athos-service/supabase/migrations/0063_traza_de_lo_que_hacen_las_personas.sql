-- La traza de lo que hacen las PERSONAS.
--
-- QUÉ HUECO CIERRA. La auditoría del 2026-08-16 midió `audit_logs` contra el principal: tenía seis
-- tipos de acción y **los seis eran del agente** (`athos_action.executed`, `whatsapp.agent_mode.auto`,
-- …). O sea que "¿quién editó el peso de este paciente?" y "¿quién canceló esta cita?" no se podían
-- contestar. En un producto que guarda historia clínica, eso no es un lujo.
--
-- LO QUE YA ESTABA BIEN, Y NO SE TOCA. Lo legalmente serio ya estaba trazado: `clinical_notes` tiene
-- `approved_at`, `approved_by` y `locked_by`, así que el momento en que una nota entra a la historia
-- clínica tiene nombre y hora — y la 0054 la vuelve inmutable después. Las facturas tienen
-- `created_by`. El hueco era todo lo que rodea a eso.
--
-- POR QUÉ UN TRIGGER Y NO LLAMADAS DESDE LA APP. Los caminos de escritura están repartidos: los RPC
-- `create_owner`/`create_patient`, un `.update()` directo desde el drawer de edición, la tool
-- `update_patient_record` del agente, el importador CSV. Una traza que dependa de que alguien se
-- acuerde de llamarla es una traza con agujeros, y un registro con agujeros es peor que ninguno:
-- invita a concluir "no pasó nada" donde lo correcto es "no lo registramos".
--
-- SÓLO UPDATE Y DELETE. Una creación es evidente por sí misma —la fila existe y tiene `created_at`—
-- mientras que un UPDATE PISA el valor anterior y un DELETE se lo lleva entero. Además el importador
-- CSV inserta cientos de filas de una vez: registrarlas enterraría bajo ruido justo las ediciones que
-- sí importan.
--
-- QUÉ PASA CON `service_role`. `auth.uid()` da NULL cuando no hay sesión de usuario, que es
-- exactamente lo que corresponde: significa "esto lo hizo el sistema, no una persona". No se inventa
-- un autor. Los crons y los webhooks caen ahí; la ejecución de acciones del agente NO, porque corre
-- bajo la sesión del vet que aprueba (ver `athos-service/CLAUDE.md`).
--
-- DATOS PERSONALES EN LA TRAZA. El payload guarda el valor anterior, y en `owners` eso incluye
-- nombre y teléfono del titular. Es deliberado —una traza que no dice QUÉ cambió no sirve— y no
-- amplía la exposición: `audit_logs` tiene RLS por clínica igual que la tabla de origen, así que lo
-- ve la misma gente que ya podía ver el dato. Consecuencia conocida: si algún día un titular ejerce
-- su derecho de supresión (Ley 1581), hay que barrer también su rastro acá.

-- ---------------------------------------------------------------------------
-- 1. La función. Una sola, genérica para las cuatro tablas.
-- ---------------------------------------------------------------------------

create or replace function private.registrar_cambio()
returns trigger
language plpgsql
security definer
-- `search_path` fijo: una función SECURITY DEFINER sin esto se puede secuestrar creando un objeto
-- con el mismo nombre en un esquema que el llamador controle. Es la misma regla que el resto de
-- `private.`.
set search_path = public, pg_temp
as $$
declare
  v_antes   jsonb;
  v_despues jsonb;
  v_cambios jsonb := '{}'::jsonb;
  v_clave   text;
begin
  if tg_op = 'DELETE' then
    v_antes := to_jsonb(old);
    insert into public.audit_logs (clinic_id, user_id, action, table_name, record_id, payload)
    values (
      (v_antes ->> 'clinic_id')::uuid,
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
$$;

comment on function private.registrar_cambio() is
  'Escribe en audit_logs cada UPDATE y DELETE de las tablas con datos de paciente. Sólo los campos '
  'que cambiaron; sin autor cuando no hay sesión (service_role), que significa "lo hizo el sistema".';

-- ---------------------------------------------------------------------------
-- 2. Los triggers. AFTER: se registra lo que YA pasó, no lo que se intenta.
-- ---------------------------------------------------------------------------

-- `appointments` está en la lista aunque la auditoría no la nombrara: es la ÚNICA de las cuatro con
-- un borrado real desde la interfaz (`create-appointment-drawer.tsx:195`), así que "¿quién canceló
-- esta cita?" es hoy la pregunta más viva del grupo. Pacientes y titulares no se borran desde
-- ninguna pantalla — todavía.

drop trigger if exists patients_traza on public.patients;
create trigger patients_traza
  after update or delete on public.patients
  for each row execute function private.registrar_cambio();

drop trigger if exists owners_traza on public.owners;
create trigger owners_traza
  after update or delete on public.owners
  for each row execute function private.registrar_cambio();

drop trigger if exists consultations_traza on public.consultations;
create trigger consultations_traza
  after update or delete on public.consultations
  for each row execute function private.registrar_cambio();

drop trigger if exists appointments_traza on public.appointments;
create trigger appointments_traza
  after update or delete on public.appointments
  for each row execute function private.registrar_cambio();

-- ---------------------------------------------------------------------------
-- 3. El índice de la pregunta que esto existe para contestar
-- ---------------------------------------------------------------------------

-- "La historia de ESTA ficha" es el acceso que justifica la traza, y hoy sería un escaneo completo:
-- el único índice es `(clinic_id, created_at)`, que sirve para "qué pasó en la clínica" y no para
-- "qué le pasó a este paciente". Con una fila por edición, la tabla deja de ser pequeña rápido.
--
-- `table_name` NO entra en el índice a propósito: `record_id` es un uuid y ya discrimina solo, así
-- que agregarlo sólo engordaría el índice. Postgres lo aplica igual como filtro.
create index if not exists idx_audit_record
  on public.audit_logs (record_id, created_at desc);

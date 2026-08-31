-- El tercer nivel de la barra de autonomía: VetGPT agenda y confirma sin pasar por la bandeja.
--
-- Pedido de Luciano el 28-ago (24:07): «una barrita en la que el usuario pudiera ir graduando el
-- nivel de autonomía». La barra se construyó ese mismo día con TRES niveles y sólo DOS operables —
-- el tercero quedó con el candado puesto y un comentario que decía qué faltaba. Esto lo abre.
--
-- ── POR QUÉ UNA COLUMNA Y NO UN VALOR NUEVO DEL ENUM ──────────────────────────────────────────
--
-- `whatsapp_agent_mode` ya tiene cuatro valores ('auto','review','paused','intervene') y agregarle
-- un quinto parecía lo natural. Es la trampa: TODO el sistema pregunta `agent_mode = 'auto'` y se
-- apaga si no lo es — `lib/whatsapp/auto-reply.ts` y `lib/cartera/wa-router.ts` son dos que se ven a
-- simple vista. Una clínica en un modo `autoconfirm` se quedaría con el agente ENTERO mudo, que es
-- exactamente la clase de bug que esta tanda de trabajo viene a arreglar, y por la misma vía: un
-- camino que se apaga sin avisar.
--
-- La columna es aditiva. `agent_mode` sigue significando una sola cosa —¿está autorizado a hablar
-- solo?— y la columna nueva responde otra: ¿hasta dónde puede llegar cuando habla.
--
-- ── POR QUÉ HACE FALTA UNA FUNCIÓN NUEVA PARA AGENDAR ─────────────────────────────────────────
--
-- `create_owner`, `create_patient` y `create_appointment` resuelven la clínica con
-- `private.my_clinic_id()`, que lee `auth.uid()`. El modo automático corre desde un webhook, sin
-- sesión: con `service_role` no hay `auth.uid()`, la función devuelve null y las tres levantan
-- 'No clinic assigned to current user'. O sea que el camino automático NO PUEDE reusarlas, por más
-- que el ejecutor de la bandeja las use sin problema.
--
-- No se resuelve con `insert` directo desde Next: las tres RPC tienen reglas de verdad (la cita
-- exige paciente, titular, vet y motivo, y comprueba que el titular sea de la clínica), y saltárselas
-- para ahorrar una función es cómo se llega a citas huérfanas. Ésta hace lo mismo, en una
-- transacción, con la clínica explícita.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: `update whatsapp_integrations set
-- confirma_citas_solo = false` devuelve a todo el mundo al comportamiento anterior.

-- ── 1 · El interruptor ────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_integrations
  add column if not exists confirma_citas_solo boolean not null default false;

comment on column public.whatsapp_integrations.confirma_citas_solo is
  'Nivel 3: VetGPT agenda la cita sin esperar la aprobación de un vet. Sólo tiene efecto con agent_mode = auto. Ver 0102.';

-- ESTA TABLA TIENE GRANTS POR COLUMNA (0031), no por tabla. Sin esta línea la columna existe, la
-- API la ignora y la pantalla nunca se entera de que el nivel 3 está encendido — un fallo mudo.
grant select (confirma_citas_solo) on public.whatsapp_integrations to authenticated;

-- ── 2 · Agendar sin sesión ────────────────────────────────────────────────────────────────────
--
-- Todo o nada: si la cita falla, el titular y el paciente que se acaban de crear se van con ella.
-- Es la diferencia con el camino de la bandeja, que puede permitirse dejar el titular creado y
-- pedirle al vet que termine a mano — allá hay una persona leyendo el mensaje de error. Acá no hay
-- nadie, y medio registro huérfano no lo va a limpiar nunca.

create or replace function public.agendar_desde_whatsapp(
  p_clinic_id  uuid,
  p_vet_id     uuid,
  p_nombre     text,
  p_telefono   text,
  p_email      text,
  p_mascota    text,
  p_especie    text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_reason     text,
  p_sin_hora   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner_id   uuid;
  v_patient_id uuid;
  v_cita_id    uuid;
begin
  if p_clinic_id is null or p_vet_id is null then
    raise exception 'Falta la clínica o el veterinario responsable.';
  end if;

  -- EL VET TIENE QUE SER DE ESTA CLÍNICA. Es la comprobación que `create_appointment` hace y que un
  -- insert directo se saltaría: sin ella, un `p_vet_id` equivocado colgaría la cita de la agenda de
  -- otra clínica.
  if not exists (
    select 1 from public.profiles where id = p_vet_id and clinic_id = p_clinic_id
  ) then
    raise exception 'El veterinario responsable no pertenece a esa clínica.';
  end if;

  insert into public.owners (clinic_id, full_name, phone, email, notes)
  values (
    p_clinic_id,
    p_nombre,
    nullif(p_telefono, ''),
    nullif(p_email, ''),
    'Se registró solo, pidiendo cita por WhatsApp. La cita la confirmó VetGPT.'
  )
  returning id into v_owner_id;

  insert into public.patients (clinic_id, owner_id, name, species, sex)
  values (p_clinic_id, v_owner_id, p_mascota, coalesce(nullif(p_especie, ''), 'Sin especificar'), 'unknown')
  returning id into v_patient_id;

  insert into public.appointments (
    clinic_id, title, starts_at, ends_at, patient_id, owner_id, vet_id, reason, status, notes, sin_hora
  )
  values (
    p_clinic_id,
    p_mascota || ' — ' || p_reason,
    p_starts_at,
    p_ends_at,
    v_patient_id,
    v_owner_id,
    p_vet_id,
    p_reason,
    'scheduled',
    case when p_sin_hora
      then 'Agendada por VetGPT desde WhatsApp, sin hora acordada.'
      else 'Agendada por VetGPT desde WhatsApp.'
    end,
    coalesce(p_sin_hora, false)
  )
  returning id into v_cita_id;

  return jsonb_build_object(
    'owner_id', v_owner_id,
    'patient_id', v_patient_id,
    'appointment_id', v_cita_id
  );
end;
$function$;

comment on function public.agendar_desde_whatsapp is
  'Crea titular + paciente + cita en una transacción, con la clínica explícita. Para el modo automático, que corre sin auth.uid(). Ver 0102.';

-- VIVE EN `public` PORQUE PostgREST SÓLO EXPONE ESE ESQUEMA —el servidor de Next la llama por RPC
-- con service_role— PERO NO LA PUEDE LLAMAR NADIE MÁS. Sin este revoke, cualquiera con la clave
-- anónima le sembraría titulares, pacientes y citas a la clínica que quisiera. Mismo patrón que
-- `canjear_codigo` en la 0100: `security definer` sin revoke es el footgun clásico.
revoke all on function public.agendar_desde_whatsapp(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, text, boolean) from public;
revoke all on function public.agendar_desde_whatsapp(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, text, boolean) from anon, authenticated;

-- ── Comprobación, para correr después de aplicarla ────────────────────────────────────────────
--
--   select count(*) from public.whatsapp_integrations where confirma_citas_solo;   -- 0
--   select has_function_privilege('anon',
--     'public.agendar_desde_whatsapp(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text,boolean)',
--     'execute');                                                                  -- false

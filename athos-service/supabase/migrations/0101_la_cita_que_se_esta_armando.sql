-- La cita que se está armando: dónde va cada conversación de WhatsApp.
--
-- ── EL AGUJERO QUE TAPA, MEDIDO EL 30-AGO ─────────────────────────────────────────────────────
--
-- Un número no registrado le pidió cita a `Clinica de Santiago Tellez`. VetGPT contestó dos veces,
-- juntó el nombre y el de la mascota, y cuando el titular dijo «Mañana» se quedó mudo — también
-- ante «?», «?» y «a qué horas quedó mi cita?». Los cuatro entrantes quedaron reclamados y sin una
-- sola respuesta.
--
-- La causa próxima (una nota falsa sobre los horarios) se arregló aparte. Lo que esta migración
-- ataca es la causa de fondo: **el agente no tenía forma de saber que estaba a mitad de algo**. Se
-- reconstruye desde cero en cada mensaje leyendo los últimos 12 del hilo, y con eso no se puede
-- responder ninguna de las dos preguntas que importan: «¿esta persona está agendando?» y «¿qué
-- datos ya me dio?».
--
-- ── POR QUÉ UNA TABLA Y NO UNA FILA DE `athos_actions` ────────────────────────────────────────
--
-- Es la opción que más tienta —ya existe `conversation_key`, ya hay un `status`— y es la peor.
-- `components/whatsapp/inbox.tsx` carga TODA fila `status='proposed'` de esa conversación y la
-- pinta como tarjeta con botón «Aprobar». Un borrador con el nombre y nada más aparecería ahí, y
-- aprobarlo mandaría `create_owner` con basura. Para evitarlo habría que filtrar el `tool_name`
-- nuevo en la bandeja, en la tarjeta, en los pasos, en el detalle, en el validador de payloads y en
-- el contador de pendientes: seis lugares para olvidarse de uno.
--
-- Y la semántica no encaja. Un borrador no se «aprueba» ni se «rechaza», que es todo el vocabulario
-- de `athos_actions.status`. Peor: esa tabla tiene `expires_at default now() + 7 days`, o sea que
-- le pondría vencimiento a algo que no debe vencer así.
--
-- Una fila `proposed` sigue siendo la solicitud FORMAL, cuando ya están todos los datos. Esta tabla
-- es el rato anterior, que es justo donde vivía el bug.
--
-- ── POR QUÉ NO LLEVA `expires_at` ─────────────────────────────────────────────────────────────
--
-- A propósito, y es una decisión de producto: una conversación entregada al vet y nunca atendida
-- tiene que SEGUIR VIÉNDOSE. Si venciera sola, «la conversación está completa» sería mentira a los
-- siete días y del otro lado hay una persona que pidió una cita y nunca supo nada.
--
-- Aplicar en el principal (`auxlnexhkmtoedrzfsnz`). Reversible: `drop table` — nada más la lee, y
-- sin ella el agente vuelve exactamente al comportamiento anterior (`auto-reply` falla abierto).

create table if not exists public.whatsapp_conversation_state (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics(id) on delete cascade,
  -- EL MISMO VALOR QUE `athos_actions.conversation_key`: el teléfono con `replace(/\D/g,"")`, tal
  -- como lo arma `digits()` en `lib/whatsapp/auto-reply.ts`. Si los dos divergen, el estado y el
  -- anti-loop dejan de hablar del mismo chat — el mismo peligro que ya está anotado allá.
  conversation_key    text not null,

  intencion           text not null default 'general'
                        check (intencion in ('general', 'cita', 'clinico')),
  estado              text not null default 'recolectando'
                        check (estado in ('recolectando', 'confirmando', 'resuelta', 'entregada_al_vet')),

  -- Los datos que se le fueron sacando: nombre, mascota, especie, motivo, correo, día y hora. La
  -- forma la manda `lib/whatsapp/datos-de-la-cita.ts` y NO se valida acá a propósito: es un
  -- borrador que se llena de a pedazos, y un CHECK sobre él convertiría cada dato incompleto en un
  -- error de base en mitad de una conversación.
  datos               jsonb not null default '{}'::jsonb,

  -- Turnos seguidos sin llenar ningún dato nuevo. Es lo que decide cuándo dejar de insistir y
  -- entregarle la conversación a una persona, en vez de repetir la misma pregunta para siempre.
  mensajes_sin_avance integer not null default 0 check (mensajes_sin_avance >= 0),

  -- Por qué se entregó: `sin_horarios`, `sin_avance`, `tope_diario`, `sin_cupo_de_ia`, `plan_free`.
  -- Hoy los cuatro caminos que cortan el modo automático hacen `return` sin dejar rastro, y por eso
  -- «¿por qué no contestó?» no se puede responder sin leer código.
  motivo              text,

  action_id           uuid references public.athos_actions(id) on delete set null,
  appointment_id      uuid references public.appointments(id) on delete set null,

  ultimo_avance_en    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- UNA FILA POR CONVERSACIÓN. Es lo que hace que el upsert de cada mensaje entrante sea una sola
  -- operación y no un lee-decide-escribe con una carrera adentro.
  constraint whatsapp_conversation_state_una_por_chat unique (clinic_id, conversation_key)
);

comment on table public.whatsapp_conversation_state is
  'Dónde va cada conversación de WhatsApp: si está agendando y qué datos ya dio. Ver 0101.';
comment on column public.whatsapp_conversation_state.datos is
  'Borrador de la cita. La forma la manda lib/whatsapp/datos-de-la-cita.ts; sin CHECK a propósito.';
comment on column public.whatsapp_conversation_state.motivo is
  'Por qué se entregó al vet. Sin esto, «¿por qué no contestó?» no se puede responder.';

alter table public.whatsapp_conversation_state enable row level security;

-- Los miembros de la clínica LA VEN (la bandeja muestra qué conversaciones quedaron esperando).
-- INSERT/UPDATE: sin policies — sólo `service_role`, que es quien corre el modo automático desde el
-- webhook, sin sesión. Mismo reparto que `athos_actions` (0029).
create policy "whatsapp_conversation_state_select" on public.whatsapp_conversation_state
  for select using (clinic_id = (select private.my_clinic_id()));

-- Para la pregunta que va a hacer la bandeja: «¿qué conversaciones de esta clínica quedaron
-- esperando a una persona?».
create index if not exists idx_wa_conversation_state_pendientes
  on public.whatsapp_conversation_state (clinic_id, estado, updated_at desc);

-- ── Comprobación, para correr después de aplicarla ────────────────────────────────────────────
--
--   select count(*) from public.whatsapp_conversation_state;   -- 0
--   select count(*) from pg_policies
--    where tablename = 'whatsapp_conversation_state';           -- 1 (sólo el select)

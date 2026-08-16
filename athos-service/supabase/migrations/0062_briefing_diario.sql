-- El briefing diario de la clínica: lo único de la capa agéntica que gasta IA.
--
-- QUÉ ES. Una vez al día, Athos redacta en dos o tres frases lo que las señales determinísticas ya
-- saben (`lib/senales/`): notas sin aprobar, titulares esperando respuesta, cobros vencidos, citas
-- del día. El modelo NO decide nada — sólo redacta. Si esta llamada falla o está apagada, las
-- señales siguen viéndose en el riel exactamente igual.
--
-- POR QUÉ UNA TABLA Y NO `athos_messages`. Hace falta idempotencia: el barrido corre desde una
-- GitHub Action que no tiene SLA de puntualidad y puede dispararse dos veces. Con
-- `unique (clinic_id, fecha)` el segundo intento choca contra la restricción en vez de generar —y
-- pagar— un segundo briefing del mismo día. La unicidad es la guarda, no un `if` en el código.

create table if not exists public.clinic_briefings (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  -- El DÍA DE BOGOTÁ, no un timestamp. Un briefing es de un día del calendario del negocio, y con
  -- `timestamptz` el de las 20:00 de Bogotá caería en el día siguiente en UTC.
  fecha       date not null,
  texto       text not null,
  -- Qué señales había cuando se redactó. Sirve para dos cosas: explicar por qué dijo lo que dijo, y
  -- poder evaluar después si el texto refleja los datos.
  senales     jsonb not null default '[]'::jsonb,
  ai_model    text,
  created_at  timestamptz not null default now(),

  constraint clinic_briefings_unicos_por_dia unique (clinic_id, fecha)
);

create index if not exists clinic_briefings_clinic_fecha_idx
  on public.clinic_briefings (clinic_id, fecha desc);

alter table public.clinic_briefings enable row level security;

-- Lectura por clínica, con la forma que el linter pide: `(select ...)` para que la función se
-- evalúe UNA vez por consulta y no una por fila. Ver la migración 0061.
create policy "clinic_briefings_select" on public.clinic_briefings
  for select using (clinic_id = (select private.my_clinic_id()));

-- SIN policies de INSERT/UPDATE/DELETE, y es deliberado: el briefing lo escribe el cron con
-- `service_role`, que se salta la RLS. Un veterinario no tiene por qué poder fabricarse un resumen
-- del día — es lo mismo que se hizo con `athos_agent_usage` en la 0052.

comment on table public.clinic_briefings is
  'Resumen diario redactado por Athos a partir de las señales deterministicas. Una fila por clinica '
  'y por dia (unique); lo escribe el cron con service_role.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- El interruptor, por clínica
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- APAGADO = CERO LLAMADAS AL MODELO, no una llamada que se descarta. El barrido filtra por esta
-- columna ANTES de armar nada, así que una clínica que no lo quiere no lo paga.
--
-- Nace en `true` porque el consumo es marginal —unas 30 llamadas al mes contra un techo de 1000, o
-- sea el 3%— y porque el valor sólo se ve usándolo. El que no lo quiera lo apaga.

alter table public.clinics
  add column if not exists briefing_enabled boolean not null default true;

comment on column public.clinics.briefing_enabled is
  'Si false, el cron NI SIQUIERA llama al modelo para esta clinica. Apagado = cero gasto.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- La superficie de costo
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- Sin esto el INSERT en `athos_agent_usage` chocaría contra el check y el consumo del briefing
-- quedaría sin registrar — invisible en /admin/costos, que es justo donde tiene que verse porque es
-- gasto que ocurre SIN que ningún vet lo haya pedido.

alter table public.athos_agent_usage drop constraint if exists athos_agent_usage_surface_check;
alter table public.athos_agent_usage add constraint athos_agent_usage_surface_check
  check (surface in (
    'agent',
    'suggest_reply',
    'auto_reply',
    'cartera_inbound',
    'vision_recipe',
    'vision_purchase',
    'widget',
    'briefing'
  ));

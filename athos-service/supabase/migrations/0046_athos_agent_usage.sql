-- 0046 — Uso del agente que vive en Next (`src/lib/athos-agent/`).
--
-- POR QUÉ. Hasta ahora el consumo de ese agente era INVISIBLE, no sólo "no mostrado": el agente con
-- herramientas, la sugerencia de WhatsApp, el modo auto y la visión de facturas llaman al proveedor
-- desde Next y NO escriben en ninguna tabla de uso. `rag_answer_log` sólo lo alimenta athos-service.
-- Por eso `/admin/costos` no podía cobrar Anthropic: el dato no existía en ningún lado.
--
-- Y de paso resuelve el pendiente que el propio repo tenía anotado (`admin/uso/page.tsx`,
-- `ESTADO.md`): acá sí se guardan `tokens_in`/`tokens_out`, que el AI SDK ya devuelve en
-- `result.usage`. Todo lo demás del panel sigue siendo una estimación por nº de llamadas; esta
-- tabla es la primera fuente de costo REAL.
--
-- `fell_back_from` cierra el círculo con la cascada entre proveedores: cuando el primario se cae
-- por saldo o cuota, acá queda registrado quién respondió Y a quién sustituyó. Sin esa columna la
-- factura del respaldo aparecería sin explicación.

create table public.athos_agent_usage (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references public.clinics(id) on delete cascade,
  user_id        uuid references public.profiles(id) on delete set null,  -- null en modo auto y crons
  -- Qué superficie gastó. Texto con check en vez de enum: estas superficies se agregan seguido y un
  -- `alter type ... add value` no corre dentro de una transacción.
  surface        text not null check (surface in (
                   'agent', 'suggest_reply', 'auto_reply', 'cartera_inbound',
                   'vision_recipe', 'vision_purchase'
                 )),
  provider       text not null,
  model          text not null,
  -- Modelo primario que falló, cuando respondió un respaldo de la cascada. Null = respondió el primario.
  fell_back_from text,
  tokens_in      integer,
  tokens_out     integer,
  created_at     timestamptz not null default now()
);

alter table public.athos_agent_usage enable row level security;

-- Los miembros de la clínica ven SU consumo. INSERT/UPDATE sin policy: sólo service_role, desde las
-- rutas de Next — igual que `athos_actions` (0029). El panel /admin también lee con service_role,
-- que se salta RLS a propósito para ver todas las clínicas.
create policy "athos_agent_usage_select" on public.athos_agent_usage
  for select using (clinic_id = (select private.my_clinic_id()));

-- El panel agrupa por modelo dentro de una ventana de 30 días, y la clínica lee lo suyo.
create index idx_athos_agent_usage_clinic on public.athos_agent_usage (clinic_id, created_at desc);
create index idx_athos_agent_usage_model on public.athos_agent_usage (created_at desc, model);
create index idx_athos_agent_usage_user on public.athos_agent_usage (user_id);

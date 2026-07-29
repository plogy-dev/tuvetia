-- 0031: modo auto de Athos sobre WhatsApp (por clínica, opt-in).
-- El enum whatsapp_agent_mode existía desde el esquema base sin usarse; acá se estrena a nivel
-- integración: 'review' (default, Athos solo sugiere) o 'auto' (Athos responde solo entrantes NO
-- clínicos: horarios, ubicación, citas). auto_daily_limit es el freno de costo/abuso por clínica.

alter table public.whatsapp_integrations
  add column if not exists agent_mode public.whatsapp_agent_mode not null default 'review',
  add column if not exists auto_daily_limit integer not null default 30
    check (auto_daily_limit between 0 and 500);

-- El SELECT de authenticated es por columnas (0024): las nuevas hay que otorgarlas explícito.
grant select (agent_mode, auto_daily_limit) on public.whatsapp_integrations to authenticated;

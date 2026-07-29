-- 0032: tercer proveedor de WhatsApp — Evolution API (Baileys, protocolo WhatsApp Web NO oficial).
-- Decisión del usuario 2026-07-28: sin trámite de Meta ni plantillas; QR dentro de tuvetia y el
-- agente responde. El riesgo (baneo del número de la clínica) se mitiga con protecciones de
-- comportamiento y se CONSIENTE explícitamente: unofficial_consent_at guarda cuándo el vet aceptó
-- el aviso de integración no oficial. La capa de proveedor permite convivir kapso/meta/evolution
-- por tenant y migrar una clínica baneada al camino oficial en minutos.

alter table public.whatsapp_integrations
  drop constraint if exists whatsapp_integrations_provider_check;
alter table public.whatsapp_integrations
  add constraint whatsapp_integrations_provider_check
    check (provider in ('kapso', 'meta', 'evolution'));

alter table public.whatsapp_integrations
  add column if not exists evolution_instance text,
  add column if not exists unofficial_consent_at timestamptz,
  add column if not exists unofficial_consent_by uuid references public.profiles(id) on delete set null;

create unique index if not exists idx_wa_integrations_evolution_instance
  on public.whatsapp_integrations (evolution_instance)
  where evolution_instance is not null;

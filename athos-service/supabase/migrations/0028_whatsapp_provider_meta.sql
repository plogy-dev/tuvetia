-- 0028: capa de proveedor de WhatsApp (Kapso hoy → Meta Cloud API directa como objetivo).
-- Ruteo por tenant: whatsapp_integrations.provider ('kapso' default, 'meta' para migradas).
-- El business token de Meta se guarda cifrado (AES-256-GCM app-level) Y la columna queda fuera
-- del SELECT de clientes PostgREST (doble protección; supera el patrón 0007 que guarda en claro).

alter table public.whatsapp_integrations
  alter column kapso_customer_id drop not null;

alter table public.whatsapp_integrations
  add column if not exists provider text not null default 'kapso'
    check (provider in ('kapso','meta')),
  add column if not exists waba_id text,
  add column if not exists meta_phone_number_id text,
  add column if not exists access_token_enc text,
  add column if not exists token_expires_at timestamptz;

-- El token cifrado no viaja a ningún cliente: SELECT por columnas para authenticated.
revoke select on public.whatsapp_integrations from anon, authenticated;
grant select (id, clinic_id, provider, phone_number, status, connected_at, created_at, updated_at)
  on public.whatsapp_integrations to authenticated;

create unique index if not exists idx_wa_integrations_meta_phone
  on public.whatsapp_integrations (meta_phone_number_id)
  where meta_phone_number_id is not null;

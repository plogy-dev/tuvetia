-- ============================================================
-- 0015_whatsapp_integrations.sql
-- WhatsApp multi-tenant vía Kapso — conexión por clínica.
--
-- Cada clínica se representa como un "customer" en Kapso; el vet conecta su propio número con un
-- setup link hosteado (QR / coexistence). Esta tabla guarda ese vínculo y su estado. Las escrituras
-- las hace SOLO el backend (service_role: routes /api/whatsapp/*); el cliente solo LEE el estado
-- para pintar "conectado / pendiente". Modelo calcado de calendar_integrations (0007).
-- ============================================================

create table if not exists public.whatsapp_integrations (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null unique references public.clinics(id) on delete cascade,
  kapso_customer_id  text not null,
  phone_number       text,
  status             text not null default 'pending'
                     check (status in ('pending','connected','disconnected')),
  setup_link_url     text,
  connected_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.whatsapp_integrations enable row level security;

-- Solo lectura para los miembros de la clínica; escrituras vía service_role (sin policy de insert/update).
create policy "whatsapp_integrations_select" on public.whatsapp_integrations
  for select using (clinic_id = (select private.my_clinic_id()));

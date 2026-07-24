-- ============================================================
-- 0018_whatsapp_inbox.sql
-- Bandeja de Comunicaciones (WhatsApp) — lo que faltaba en BD:
--   1. whatsapp_integrations.kapso_phone_number_id: el id del número en Kapso, necesario para
--      ENVIAR mensajes (POST /meta/whatsapp/v24.0/{phone_number_id}/messages). Lo guarda el
--      route /api/whatsapp/status al verificar la conexión.
--   2. Policy UPDATE en whatsapp_messages (la tabla base solo tenía SELECT+INSERT): la bandeja
--      marca los mensajes ENTRANTES como leídos (read_at) al abrir la conversación.
--      Nota semántica: read_at en inbound = "visto por la clínica"; en outbound lo escribe el
--      webhook con los estados de WhatsApp (visto por el titular). No chocan: ids distintos.
-- ============================================================

alter table public.whatsapp_integrations
  add column if not exists kapso_phone_number_id text;

create policy "whatsapp_messages_update" on public.whatsapp_messages
  for update using (clinic_id = (select private.my_clinic_id()));

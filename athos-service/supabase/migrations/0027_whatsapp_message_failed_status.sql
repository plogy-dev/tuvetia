-- 0027: estados de fallo de mensajes de WhatsApp.
-- Meta reporta status=failed (número inválido, fuera de la ventana de 24 h, plantilla requerida…).
-- Hasta ahora el webhook los ignoraba y el vet veía un solo tick creyendo que el mensaje llegó.
-- El webhook escribe failed_at + error_detail y la bandeja lo pinta en rojo con el motivo.

alter table public.whatsapp_messages
  add column if not exists failed_at timestamptz,
  add column if not exists error_detail text;

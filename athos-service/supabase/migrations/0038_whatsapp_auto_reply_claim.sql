-- 0038: reserva atómica del modo auto, para que un entrante se responda UNA sola vez.
--
-- El modo auto consultaba la idempotencia en athos_actions ANTES de llamar al modelo, pero la fila
-- que la registra se escribe DESPUÉS de enviar. Entre esas dos cosas hay varios segundos (debounce
-- de 5 s + latencia del modelo), y ahí cabe un reintento del webhook: ambas invocaciones veían
-- "no hay duplicado" y ambas respondían. El titular recibía el mensaje dos veces.
--
-- Es el mismo TOCTOU que se corrigió en las acciones de Athos (0028 / PR #28), y se corrige igual:
-- con un compare-and-set. La columna es la marca de reserva — el UPDATE condicional
-- `set auto_reply_claimed_at = now() where wa_message_id = $1 and auto_reply_claimed_at is null`
-- solo puede ganarlo una invocación; la otra recibe 0 filas y se calla.
--
-- Se reserva el ENTRANTE (no el saliente) porque la unidad de trabajo es "responder a este
-- mensaje": la reserva ocurre antes de gastar el modelo y antes de enviar nada.
--
-- Nullable a propósito: `null` = nadie lo reclamó todavía. Los mensajes viejos quedan en null y
-- nunca se van a reclamar porque el modo auto solo mira entrantes nuevos del webhook.

alter table public.whatsapp_messages
  add column if not exists auto_reply_claimed_at timestamptz;

-- El claim busca por (clinic_id, wa_message_id). Ya existe el unique de wa_message_id que usa el
-- upsert del webhook, así que el lookup va por índice; no hace falta uno nuevo.

comment on column public.whatsapp_messages.auto_reply_claimed_at is
  'Reserva del modo auto (compare-and-set): sellada por la invocación que se quedó con el derecho a responder este entrante. null = sin reclamar. Ver 0038.';

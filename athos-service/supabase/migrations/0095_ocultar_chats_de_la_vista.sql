-- 0095 — Eliminar un chat DE LA VISTA sin eliminar nada (`athos_messages.hidden_at`).
--
-- Pedido del cliente (26-ago): un botón para eliminar del historial los chats que ya no se
-- necesitan, "pero sin eliminar la información que ya se consiguió de ese paciente". Eso es un
-- OCULTAR, no un DELETE: las filas se quedan (trazabilidad, auditoría) y la memoria del paciente
-- (patient_embeddings, ficha, alergias) ni se toca — lo único que cambia es que el historial y la
-- siembra del hilo filtran `hidden_at is null`. Chatear de nuevo con ese paciente arranca un hilo
-- visualmente limpio; VetGPT igual recuerda por su memoria semántica.
--
-- Reversible por diseño: `hidden_at = null` restaura el chat tal cual (el "Deshacer" del toast).

alter table public.athos_messages
  add column if not exists hidden_at timestamptz;

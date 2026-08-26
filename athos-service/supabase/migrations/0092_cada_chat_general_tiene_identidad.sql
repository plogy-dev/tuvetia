-- 0092 — Cada chat general tiene identidad (`athos_messages.thread_key`).
--
-- Pedido del cliente (26-ago): al crear un chat nuevo, el anterior debe quedar en el historial
-- como un botón al que se puede VOLVER y seguir la conversación donde quedó. Los chats de
-- paciente ya lo hacían (su clave ES el patient_id); los GENERALES se guardaban todos con
-- patient_id null y NADA que los distinga entre sí — eran irrecuperables por diseño.
--
-- `thread_key`: la clave de conversación que el front genera por hilo general (g<timestamp>) y
-- que la ruta del agente persiste con cada turno. En los hilos de paciente se guarda el
-- patient_id (redundante pero uniforme: una sola columna responde "¿de qué conversación es esta
-- fila?"). Nullable: las filas anteriores a esta migración no la tienen y no se inventa — esos
-- chats generales viejos siguen sin ser recuperables, los nuevos sí.

alter table public.athos_messages
  add column if not exists thread_key text;

-- El índice que sirve a las dos consultas nuevas: listar los hilos generales de una clínica y
-- sembrar UNO por su clave, siempre ordenado por fecha. Parcial: las filas viejas sin clave no
-- pagan el índice.
create index if not exists athos_messages_thread_key_idx
  on public.athos_messages (clinic_id, thread_key, created_at)
  where thread_key is not null;

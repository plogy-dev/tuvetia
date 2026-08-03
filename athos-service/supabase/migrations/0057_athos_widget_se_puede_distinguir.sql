-- Athos dejó de vivir en una pantalla, y las dos tablas que lo registran no lo saben.
--
-- Desde que el widget está en todas las pantallas, una propuesta ya no viene "del chat" ni de "la
-- bandeja": puede venir de cualquier parte de la app. Los dos CHECK se quedaron con el vocabulario
-- de cuando Athos era una página.
--
-- ── athos_actions.source ────────────────────────────────────────────────────────────────────────
--
-- Hoy admite chat|inbox|auto, y el widget está mandando 'chat' — igual que ya hacía el onboarding,
-- que lo documenta en su propio código como una mentira deliberada para no pedir migración.
--
-- Con dos superficies mintiendo, `'chat'` deja de significar "la pantalla del asistente" y pasa a
-- significar "en algún lugar". La primera pregunta de soporte va a ser «el vet dice que Athos le
-- agendó algo, ¿desde dónde lo pidió?», y sin esto no hay respuesta: es una tabla de auditoría de
-- acciones que un humano aprobó, y de dónde vino la propuesta es parte del expediente.
--
-- `onboarding` entra de arriba porque es una línea más y borra un TODO ya escrito en el repo.
--
-- ── athos_agent_usage.surface ───────────────────────────────────────────────────────────────────
--
-- Sin esto el gasto del widget se disuelve dentro de `'agent'` y la pregunta que el cliente VA a
-- hacer —«¿cuánto cuesta tener a Athos siempre presente?»— no se puede responder ni a posteriori,
-- porque los datos ya se mezclaron. Medir primero y decidir después sólo funciona si la medición
-- existe desde el día uno.
--
-- ── Por qué es seguro ───────────────────────────────────────────────────────────────────────────
--
-- Los dos CHECK sólo se ENSANCHAN: todo lo que pasaba antes sigue pasando. Ninguna fila existente
-- puede violarlos, así que el `add constraint` no tiene que revalidar nada que pueda fallar.
--
-- Los nombres NO están adivinados: se leyeron de `pg_constraint` contra el proyecto principal
-- (`athos_actions_source_check`, `athos_agent_usage_surface_check`). La 0029 y la 0046 los declaran
-- inline, así que los generó Postgres y el nombre podría no haber sido el previsible.

alter table public.athos_actions drop constraint if exists athos_actions_source_check;
alter table public.athos_actions add constraint athos_actions_source_check
  check (source in ('chat', 'inbox', 'auto', 'widget', 'onboarding'));

alter table public.athos_agent_usage drop constraint if exists athos_agent_usage_surface_check;
alter table public.athos_agent_usage add constraint athos_agent_usage_surface_check
  check (surface in (
    'agent',
    'suggest_reply',
    'auto_reply',
    'cartera_inbound',
    'vision_recipe',
    'vision_purchase',
    'widget'
  ));

comment on column public.athos_actions.source is
  'Desde donde se PROPUSO la accion: chat (pantalla del asistente), widget (la burbuja, cualquier '
  'pantalla), inbox (bandeja de WhatsApp), auto (modo automatico, sin humano delante), onboarding.';

comment on column public.athos_agent_usage.surface is
  'Que superficie gasto los tokens. widget se mide aparte de agent a proposito: es la unica forma de '
  'saber cuanto cuesta que Athos este presente en toda la app.';

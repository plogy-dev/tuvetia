-- La inteligencia en vivo del Modo Fantasma gasta IA, y hasta ahora no se contaba.
--
-- EL AGUJERO. `athos_agent_usage` es lo que mide el tope mensual por clínica, y su propio comentario
-- dice por qué cuenta TODAS las superficies: «dejar afuera el modo automático y cartera —las dos que
-- gastan sin que el vet lo note— sería dejar el agujero justamente donde está el gasto que nadie
-- mira».
--
-- Las notas y sugerencias durante la consulta son exactamente eso, y más: se disparan solas mientras
-- el veterinario atiende, sin que nadie apriete nada. Sin esta fila, una función que puede gastar
-- decenas de llamadas por consulta quedaba fuera del único techo que existe.
--
-- POR QUÉ UNA SUPERFICIE PROPIA Y NO REUSAR 'agent'. Es la misma razón por la que 'widget' se mide
-- aparte: es la única forma de poder responder cuánto cuesta el Modo Fantasma en vivo. Mezclarlas
-- vuelve la pregunta incontestable incluso a posteriori, porque los datos ya quedaron sumados — y
-- ésta es justo la superficie cuyo costo hay que poder discutir antes de ponerle precio.
--
-- Es aditiva: no toca ninguna fila existente, sólo amplía qué valores se aceptan.

alter table public.athos_agent_usage
  drop constraint if exists athos_agent_usage_surface_check;

alter table public.athos_agent_usage
  add constraint athos_agent_usage_surface_check
  check (surface = any (array[
    'agent',
    'suggest_reply',
    'auto_reply',
    'cartera_inbound',
    'vision_recipe',
    'vision_purchase',
    'widget',
    'briefing',
    -- Notas y sugerencias mientras la consulta pasa (Modo Fantasma en vivo).
    'consulta_viva'
  ]));

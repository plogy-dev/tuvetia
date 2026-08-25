-- 0086 — El lector de PDFs escaneados también gasta (superficie `leer_documento`).
--
-- El chat de Athos acepta documentos adjuntos con cascada de costos (2026-08-25): la fase 1
-- (pdfjs en el navegador) extrae el texto gratis; cuando el PDF es escaneado y no trae texto
-- digital, la fase 2 lo lee con el modelo de visión (una sola llamada por documento, ruta
-- /api/athos/leer-documento). Esa llamada se registra en athos_agent_usage con surface
-- 'leer_documento' — aparte, porque es la única superficie cuyo costo escala con páginas de
-- documento y no con turnos de conversación: sumada a `agent`, la pregunta "¿el fallback
-- multimodal se puede regalar o hay que topearlo?" quedaría incontestable.
--
-- Mismo patrón que 0057/0068/0071: el check se recrea completo con el valor nuevo.

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
    'consulta_viva',
    'informe_titular',
    -- Leer con IA un PDF escaneado adjuntado al chat (0086).
    'leer_documento'
  ]));

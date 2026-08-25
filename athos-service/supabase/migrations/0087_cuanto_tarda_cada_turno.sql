-- 0087 — Cuánto tarda cada turno del agente (`athos_agent_usage.duration_ms`).
--
-- El 25-ago los probadores reportaron "Athos tarda más de un minuto" y "se quedó en blanco", y el
-- diagnóstico tuvo que armarse por triangulación (deltas de athos_messages + promedios de tokens):
-- la tabla de consumo sabía CUÁNTO costó cada turno pero no CUÁNTO TARDÓ. Esta columna cierra ese
-- hueco: la ruta del agente mide el turno completo (loop de tools incluido) y lo registra.
--
-- Nullable a propósito: las superficies que aún no miden mandan null, y un null honesto vale más
-- que un cero que promediaría como si fuera instantáneo.

alter table public.athos_agent_usage
  add column if not exists duration_ms integer;

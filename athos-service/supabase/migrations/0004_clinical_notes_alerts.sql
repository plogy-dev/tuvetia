-- 0004 — Alertas de condición del Modo Fantasma, persistidas en la nota (Athos).
--
-- ADITIVO y NO bloqueante: columna jsonb con default '[]'. El código y los consumidores existentes
-- la ignoran (el gate de alergia sigue siendo una columna aparte, `allergy_gate_triggered`). No
-- re-crea la tabla ni toca otras columnas. Se aplica dev -> PR -> principal con `supabase db push`.
--
-- El backend (app/phantom.py) detecta en runtime si esta columna existe y solo entonces persiste
-- las alertas, así que el código puede desplegarse ANTES o DESPUÉS de aplicar esta migración sin
-- romper el insert de la nota.
alter table public.clinical_notes
  add column if not exists alerts jsonb not null default '[]'::jsonb;

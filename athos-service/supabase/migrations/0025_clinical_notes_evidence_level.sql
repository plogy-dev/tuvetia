-- 0025 — Nivel de evidencia de la nota del Modo Fantasma (Athos).
--
-- Hasta ahora la insuficiencia de evidencia era BINARIA y sólo vivía en `rag_answer_log`
-- (insufficient_evidence). El juez semántico (app/generation/evidence_judge.py) devuelve una banda:
--   'none'       -> los pasajes recuperados no sostienen el caso (Athos se abstiene)
--   'limited'    -> rozan el tema pero no la condición: la nota se marca como orientación indirecta
--   'sufficient' -> tratan la condición
-- Persistirlo en la nota permite que el revisor vea el nivel al APROBARLA, no sólo al generarla.
--
-- ADITIVO y NO bloqueante: columna text con default 'sufficient' (las notas viejas conservan el
-- comportamiento anterior). No re-crea la tabla ni toca otras columnas. Se aplica dev -> PR ->
-- principal con `supabase db push`.
--
-- El backend detecta en runtime si esta columna existe y sólo entonces la persiste, así que el
-- código puede desplegarse ANTES o DESPUÉS de aplicar esta migración sin romper el insert.
alter table public.clinical_notes
  add column if not exists evidence_level text not null default 'sufficient';

alter table public.clinical_notes
  drop constraint if exists clinical_notes_evidence_level_check;

alter table public.clinical_notes
  add constraint clinical_notes_evidence_level_check
  check (evidence_level in ('none', 'limited', 'sufficient'));

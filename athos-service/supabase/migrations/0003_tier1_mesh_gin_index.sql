-- 0003 — Índice GIN para el predicado MeSH del Tier 1 (rendimiento del retrieval a escala)
--
-- El Tier 1 (app/retrieval/cascade.py :: tier1_lexical_glossary) filtra por:
--     tsv @@ websearch_to_tsquery(...)  OR  metadata->'mesh' ?| ARRAY[...]
--
-- Existe GIN sobre `tsv` (0001) y GIN sobre `metadata` completo, pero el operador `?|` se aplica
-- sobre la EXPRESIÓN `metadata->'mesh'`, que el GIN de `metadata` no cubre. Con esa rama sin
-- índice, un `A OR B` fuerza Seq Scan de todo `corpus_chunks` (medido: ~44 s con 67k chunks,
-- leyendo la columna `content` entera de cada fila).
--
-- Este índice de expresión hace indexable la rama MeSH -> el planner usa BitmapOr de los dos GIN.
-- Medido tras crearlo: ~2 s (≈20× más rápido). Afecta solo al corpus (tabla global, sin clinic_id).

create index if not exists corpus_chunks_mesh_gin
    on public.corpus_chunks using gin ((metadata -> 'mesh'));

analyze public.corpus_chunks;

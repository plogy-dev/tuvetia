-- 0002 — Estrategia de indice vectorial: HNSW
-- Motivo: mayor calidad de recall/latencia y mas robusto al crecer que ivfflat, sin depender
-- de tunear `lists`. Decision de plataforma (largo plazo).
--
-- OJO (coordinacion): esto reemplaza los indices vectoriales que crea el ESQUEMA BASE
-- (ivfflat) en dos tablas GENERALES: corpus_chunks y patient_embeddings. Antes de aplicar a
-- main hay que coordinarlo con el equipo (Santiago/Pipe): si esas tablas ya tienen datos,
-- planificar el rebuild del indice. Ver docs/MIGRACIONES.md.
--
-- HNSW con parametros por defecto (m=16, ef_construction=64), suficientes para el corpus.

-- corpus_chunks: reemplazar el ivfflat del base por HNSW (mismo nombre de indice)
drop index if exists public.corpus_chunks_embedding_idx;
create index if not exists corpus_chunks_embedding_idx
  on public.corpus_chunks using hnsw (embedding vector_cosine_ops);

-- patient_embeddings: quitar el ivfflat del base y dejar HNSW (patient_embeddings_idx)
drop index if exists public.patient_embeddings_embedding_idx;
create index if not exists patient_embeddings_idx
  on public.patient_embeddings using hnsw (embedding vector_cosine_ops);

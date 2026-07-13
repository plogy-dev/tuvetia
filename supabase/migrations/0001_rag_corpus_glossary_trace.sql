-- RAG: índices de corpus_chunks, glosario, trazabilidad, RLS.
-- Ajustar vector(1024) a la dimensión del modelo de embeddings elegido.
create extension if not exists vector;

alter table public.corpus_chunks alter column embedding type vector(1024);
alter table public.corpus_chunks add column if not exists tsv tsvector;
create index if not exists corpus_chunks_embedding_idx on public.corpus_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists corpus_chunks_tsv_idx on public.corpus_chunks using gin (tsv);
create index if not exists corpus_chunks_metadata_idx on public.corpus_chunks using gin (metadata);
alter table public.corpus_chunks enable row level security;
create policy corpus_chunks_read on public.corpus_chunks for select to authenticated using (true);

alter table public.patient_embeddings alter column embedding type vector(1024);
create index if not exists patient_embeddings_idx on public.patient_embeddings using hnsw (embedding vector_cosine_ops);
create index if not exists patient_embeddings_clinic_idx on public.patient_embeddings (clinic_id, patient_id);

create table if not exists public.glossary_term (
  id uuid primary key default gen_random_uuid(), canonical_en text not null, mesh_id text, category text,
  species text[] not null default '{}', short_def text, technical_def text, warnings text, confidence numeric(3,2),
  review_status text not null default 'candidate', reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.glossary_synonym (
  id uuid primary key default gen_random_uuid(), term_id uuid not null references public.glossary_term(id) on delete cascade,
  text text not null, lang text not null, register text, origin text not null,
  review_status text not null default 'candidate', created_at timestamptz not null default now());
create index if not exists glossary_synonym_term_idx on public.glossary_synonym (term_id);
create index if not exists glossary_synonym_text_idx on public.glossary_synonym (lower(text));
create table if not exists public.glossary_relation (
  from_term uuid not null references public.glossary_term(id) on delete cascade,
  to_term uuid not null references public.glossary_term(id) on delete cascade,
  relation text not null, primary key (from_term, to_term, relation));
alter table public.glossary_term enable row level security;
alter table public.glossary_synonym enable row level security;
alter table public.glossary_relation enable row level security;
create policy glossary_term_read on public.glossary_term for select to authenticated using (true);
create policy glossary_synonym_read on public.glossary_synonym for select to authenticated using (true);
create policy glossary_relation_read on public.glossary_relation for select to authenticated using (true);

create table if not exists public.athos_messages (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid, patient_id uuid, role text not null, content text not null, retrieval_id uuid, created_at timestamptz not null default now());
create table if not exists public.rag_retrieval_log (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid, patient_id uuid, source text not null, query_raw text, query_used text, concepts text[], filters jsonb,
  tier_reached text, chunk_ids uuid[] not null default '{}', scores jsonb, top_score numeric, passed_threshold boolean, created_at timestamptz not null default now());
create table if not exists public.rag_answer_log (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade,
  retrieval_id uuid references public.rag_retrieval_log(id), message_id uuid references public.athos_messages(id),
  note_id uuid references public.clinical_notes(id), answer text, citations jsonb,
  insufficient_evidence boolean not null default false, severe_allergy_flagged boolean not null default false,
  model text, created_at timestamptz not null default now());
alter table public.athos_messages enable row level security;
alter table public.rag_retrieval_log enable row level security;
alter table public.rag_answer_log enable row level security;
create policy athos_messages_rw on public.athos_messages for all to authenticated
  using (exists (select 1 from public.memberships m where m.clinic_id = athos_messages.clinic_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.memberships m where m.clinic_id = athos_messages.clinic_id and m.user_id = auth.uid()));
create policy rag_retrieval_rw on public.rag_retrieval_log for all to authenticated
  using (exists (select 1 from public.memberships m where m.clinic_id = rag_retrieval_log.clinic_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.memberships m where m.clinic_id = rag_retrieval_log.clinic_id and m.user_id = auth.uid()));
create policy rag_answer_rw on public.rag_answer_log for all to authenticated
  using (exists (select 1 from public.memberships m where m.clinic_id = rag_answer_log.clinic_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.memberships m where m.clinic_id = rag_answer_log.clinic_id and m.user_id = auth.uid()));
alter table public.clinical_notes add column if not exists citations jsonb;

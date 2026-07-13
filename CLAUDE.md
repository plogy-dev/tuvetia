# CLAUDE.md — Athos (RAG veterinario de Tuvetia)

Contexto y reglas del servicio. Léelo completo antes de escribir código. Diseño detallado en `tuvetia_rag_documento_final.md`; esquema en `Tablas_de_Supabase.md`. **Todas las decisiones están cerradas.**

## Qué es este servicio
Microservicio Python + FastAPI que (1) responde consultas clínicas del veterinario (chat de Athos) y (2) genera sugerencias al cerrar una consulta (Modo Fantasma), **citando literatura veterinaria verificable**. Filosofía: **gastar la menor IA posible**. Un buscador determinístico con un glosario médico hace el retrieval (sin tokens); la IA solo **entiende la consulta (A→B)** y **redacta la respuesta citada (B→A)**.

Despliegue: **Railway**. Base de datos: **Supabase** (Postgres + pgvector). Frontend: Next.js en Vercel (lo hace Santiago) que consume estos endpoints. El Phantom lo hace Pipe.

## Reglas no negociables (el código las impone, NO los prompts)
1. **Cita o se calla.** Sin evidencia suficiente → "no hay evidencia suficiente". Nunca inventes fuentes.
2. **Lenguaje de posibilidad** ("compatible con", "sugestivo de"). **Nunca diagnóstico definitivo.**
3. **Gate de alergia severa ANTES de cualquier plan.** Determinístico, desde `allergies` con `severity='severe'`. Bloqueante. Nunca depende del LLM. Escribe `clinical_notes.allergy_gate_triggered`.
4. **Sin dosis si faltan datos** (especie, peso, edad).
5. **Aprobación humana**: ninguna nota entra a la historia sin que el vet la apruebe (`draft → aprobado`).
6. **Aislamiento por clínica.** Corpus y glosario son **globales** (sin `clinic_id`); datos y embeddings de paciente son **por clínica** (`clinic_id` + RLS). **Nunca** JOIN entre corpus y datos de paciente: caminos separados, fusión en memoria.
7. **`service_role` se salta RLS** → pasa `clinic_id` explícito en cada query del lado paciente y filtra por él. Cubierto por test.

## Motores de IA (DECIDIDOS, siempre por variable de entorno — nunca hardcodear)
- **Redacción (B→A):** `LLM_MODEL=claude-sonnet-5`. Validar `claude-opus-4-8` contra el golden set y escalar a él **solo los casos difíciles** si gana de forma medible.
- **Liviano (A→B, distilación):** `LLM_LIGHT_MODEL=claude-haiku-4-5`.
- **Embeddings:** **Cohere embed-v4** (multilingüe, recuperación cross-lingual ES→EN). `EMBEDDING_DIM=1024` (Cohere soporta 1024); corpus y `patient_embeddings` usan el **mismo** modelo/dimensión. **Cohere Rerank** es el candidato para el reranking. Siempre por env var.
- Registra el modelo usado en `rag_answer_log.model`. Usa prompt caching en el prefijo estable (prompt de sistema + definiciones del glosario).

## Modelo de datos (usa las tablas reales)
- **Global (sin `clinic_id`):** `corpus_chunks` (id, source, title, content, embedding vector(1024), metadata jsonb, tsv). Riqueza en `metadata` (especie, categoria, tier, mesh[], glossary_terms[], locator, is_current, content_hash, embedding_model…). Glosario: `glossary_term`, `glossary_synonym`, `glossary_relation`.
- **Por clínica (`clinic_id` + RLS):** `patients`, `allergies`, `medications`, `transcripts`, `clinical_notes`, `consultations`, `consents`, `patient_embeddings`, y trazabilidad `athos_messages` / `rag_retrieval_log` / `rag_answer_log`.

## La cascada de retrieval (dos entradas, un pipeline). Determinístico (gratis) vs LLM:
0. **A→B** *(determinístico + LLM liviano de respaldo)*: palabras (ES) → `glossary_synonym` → conceptos canónicos (EN + MeSH + relacionados). Si el glosario no basta, LLM liviano distila. Loguea en `rag_retrieval_log`.
1. **Tier 0 filtros** *(gratis)*: especie como **preferencia, no exclusión** (etiquetas ruidosas, 63% "mixto"; apóyate en MeSH `Cats`/`Dogs`) + idioma, `is_current`, `tier`, recencia.
2. **Tier 1 léxico + glosario** *(gratis)*: conceptos vs `mesh`/`glossary_terms` del chunk + full-text (EN) sobre `content`.
3. **Tier 2 vector** *(condicional)*: solo si Tier 1 es débil. Loguea cuándo se dispara (huecos del glosario).
4. **Umbral** *(determinístico)*: si no pasa → Athos responde plantilla **sin LLM**; Fantasma redacta la nota del transcript **sin literatura**.
5. **Fusión de contexto** *(determinístico)*: literatura global + contexto del paciente (estructurado + `patient_embeddings`, RLS por `clinic_id`+`patient_id`). En memoria, separado.
6. **Gate de alergia severa** *(determinístico, antes del plan)*.
7. **B→A generación** *(única IA)*: Fantasma = **una sola llamada** (SOAP + summary + allergy_flag). Lenguaje de posibilidad, citas mapeadas, presupuesto acotado.
8. **Verificación de citas** *(determinístico)*: cada afirmación mapea a un chunk recuperado; lo que no, se descarta. El modelo no inventa fuentes.
9. **Trazabilidad + humano**: `rag_answer_log` + `athos_messages`. El vet revisa y aprueba.

## Glosario (puente ES→EN y capa semántica)
Activo de la **plataforma** (global). Siembra automática de MeSH/DeCS + `mesh` del corpus (entran como `candidate`); curación veterinaria + lenguaje coloquial del dueño (`approved`). El retrieval usa por defecto **solo `approved`**. Es lo que más determina la calidad.

## Ingesta del corpus
Entrega: 61.544 markdown + frontmatter YAML + `manifest.csv` (validados, en inglés). Nosotros: (1) idempotente por `content_hash`; (2) frontmatter→`metadata`; (3) normalizar a texto (punto de extensión para PDFs/otros idiomas); (4) chunking con `locator` (no partir tablas/dosis); (5) embedding (una vez); (6) `tsvector` con la config del **idioma del documento**; (7) etiquetar con glosario.

## Endpoints e integración (contrato cerrado)
- `POST /athos/chat` (SSE) — chat del vet. Body `{ question, patient_id, clinic_id }`.
- `POST /athos/phantom/suggest` — **lo llama el Phantom de Pipe al cerrar la consulta.** Body `{ consultation_id, clinic_id }`. Athos crea la fila `clinical_notes` (status=draft), escribe `rag_answer_log` con `note_id`, y **devuelve**:
  `{ note_id, status:"draft", soap:{subjective,objective,assessment,plan}, allergy_gate_triggered, allergy_transcript_flag, insufficient_evidence, citations:[{chunk_id,doc_id,locator,source}], ai_model, ai_generated_at }`.
  Mapeo del `summarize.ts`: soap.subjetivo/objetivo/analisis/plan → subjective/objective/assessment/plan; `allergy_flag` → `allergy_transcript_flag`. `allergy_gate_triggered` lo calcula **Athos desde `allergies`** (no el modelo).
- `POST /ingest` (admin) — dispara la ingesta.
- `GET /health`.
- **Frontend:** verifica el JWT de Supabase que llega en `Authorization: Bearer`, resuelve `clinic_id` desde `memberships`, habilita CORS al origen del front, y sirve `/athos/chat` por SSE. `clinic_id` siempre explícito hacia la DB (service_role se salta RLS).

## Qué NO hacer
- No dejar que el LLM decida qué documentos traer, ni inventar fuentes, ni dar diagnóstico cerrado.
- No mezclar corpus (global) con datos de paciente (por clínica) en la DB.
- No hardcodear modelos de IA (siempre env var).
- No schema-por-tenant. No `clinic_id` en corpus/glosario. No omitir RLS ni el test cross-tenant en tablas por clínica.
- No `service_role` sin `clinic_id` explícito. No secretos en Git.

## Testing
El retrieval (pasos 0–6, 8) es **determinístico y testeable sin LLM** — fixtures + CI. Tests cross-tenant obligatorios en tablas por clínica.

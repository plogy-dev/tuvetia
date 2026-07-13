# Athos (RAG) — Contexto para el equipo (Santiago y Pipe)

> Todo lo que necesitan saber del microservicio de Athos y cómo se conecta con las demás partes de la plataforma. El detalle interno del RAG está en `tuvetia_rag_documento_final.md` (misma carpeta); las reglas para construirlo, en `../CLAUDE.md`; su montaje, en `../SETUP.md`; entornos y migraciones, en `MIGRACIONES.md`.

## 1. Qué es Athos y qué hace
Athos es el **microservicio de IA clínica** de la plataforma (FastAPI, desplegado en Railway). Hace dos cosas:
1. **Chat de Athos:** el veterinario pregunta y Athos responde con **literatura veterinaria citada y verificable**.
2. **Modo Fantasma:** al cerrar una consulta, Athos genera la **nota SOAP + una sugerencia** basada en la literatura y el contexto del paciente.

Filosofía: **gastar la mínima IA**. Un buscador determinístico con un diccionario médico (glosario) hace el retrieval sin gastar tokens; la IA solo **entiende** la pregunta y **redacta** la respuesta. Reglas clínicas duras: **cita o se calla**, **lenguaje de posibilidad** (nunca diagnóstico definitivo), **advierte alergias severas antes de cualquier plan**, y **el vet siempre revisa y aprueba**.

## 2. El mapa: cómo se conecta todo
```
   Frontend (Santiago, Next/Vercel)                 Phantom (Pipe)
        |  POST /athos/chat (SSE)                        |  POST /athos/phantom/suggest
        |  muestra respuesta + citas + notas             |  (al cerrar la consulta)
        v                                                v
                       ┌─────────────────────────┐
                       │   ATHOS (FastAPI/Railway)│
                       └─────────────┬───────────┘
                                     │  lee/escribe (clinic_id explícito)
                                     v
                 ┌──────────────────────────────────────────┐
                 │   SUPABASE (Postgres + pgvector)          │
                 │   Global: corpus_chunks, glossary_*       │
                 │   Por clínica (RLS): patients, allergies, │
                 │   clinical_notes, transcripts,            │
                 │   patient_embeddings, athos_messages, ... │
                 └──────────────────────────────────────────┘
```
**La base de datos compartida (Supabase) es el backbone de integración.** Athos lee el corpus/glosario (global) y los datos del paciente (por clínica), y escribe las notas y la trazabilidad.

## 3. Reglas transversales que nos afectan a todos
- **Tenancy:** esquema compartido + `clinic_id` + **RLS (default deny)**. **Cada request lleva `clinic_id`.**
- **Tablas globales** (sin `clinic_id`): `corpus_chunks`, `glossary_*`. **Tablas por clínica** (`clinic_id` + RLS): `patients`, `allergies`, `medications`, `clinical_notes`, `transcripts`, `patient_embeddings`, `athos_messages`, `rag_retrieval_log`, `rag_answer_log`.
- **Human-in-the-loop:** ninguna nota entra a la historia sin que el vet la **apruebe** (`draft → aprobado`).
- **Gate de alergia severa:** determinístico (desde `allergies` con `severity='severe'`), **antes de cualquier plan**. No depende del modelo.

## 4. Los endpoints de Athos (el contrato)
- `POST /athos/chat` (SSE) — chat del vet.
- `POST /athos/phantom/suggest` — lo llama el Phantom al cerrar la consulta.
- `POST /ingest` (admin) — indexar el corpus.
- `GET /health`.

**Auth:** quien llama manda el **JWT de Supabase del usuario** en `Authorization: Bearer <token>`. Athos lo verifica, saca el `user_id` y resuelve `clinic_id` desde `profiles` (`profiles.clinic_id`). (Athos usa `service_role` hacia la DB, por eso el `clinic_id` va explícito.)

## 5. Para Santiago (Frontend)
- **Chat:** `POST /athos/chat` con body `{ question, patient_id, clinic_id }` + el JWT del usuario. La respuesta llega por **SSE (streaming)**: muéstrala en vivo, con sus **citas** (fuentes verificables) visibles.
- **CORS:** pásame el dominio de Vercel para agregarlo a `CORS_ORIGINS`.
- **Notas (Modo Fantasma):** Athos escribe la nota en `clinical_notes` con `status=draft`. El front la muestra, permite **editar** por secciones SOAP, y el vet **aprueba** (`draft → aprobado`). **Ninguna nota se guarda en la historia sin aprobación.**
- **Presentación clínica:** nunca muestres una sugerencia como diagnóstico cerrado. El lenguaje es de posibilidad, las citas se ven, y las alergias severas se advierten antes del plan.

## 6. Para Pipe (Phantom)
- **Disparo (decidido):** cuando el vet hace **stop**, tu código llama `POST /athos/phantom/suggest` con `{ consultation_id, clinic_id }` + el JWT del usuario.
- **Qué hace Athos:** corre la cascada sobre el **transcript** de esa consulta, aplica el gate de alergia, genera la nota, la **escribe en `clinical_notes` (draft)**, registra la trazabilidad y **devuelve** el payload.
- **Shape de respuesta:**
  ```json
  { "note_id": "...", "status": "draft",
    "soap": { "subjective": "...", "objective": "...", "assessment": "...", "plan": "..." },
    "allergy_gate_triggered": true,       // DURO: desde allergies.severity='severe'
    "allergy_transcript_flag": false,      // red del modelo: alergia MENCIONADA en la consulta
    "insufficient_evidence": false,        // si no pasó el umbral, la nota va sin literatura
    "citations": [ { "chunk_id": "...", "doc_id": "...", "locator": "...", "source": "..." } ],
    "ai_model": "...", "ai_generated_at": "..." }
  ```
- **Dos capas de alergia:** el **gate duro** lo calcula **Athos** desde `allergies` (no el modelo). Tu `summarize.ts` `allergy_flag` es una **red adicional** (una alergia mencionada en la consulta) → va en `allergy_transcript_flag`.
- **Mapeo de tu `summarize.ts`:** `soap.subjetivo/objetivo/analisis/plan` → `clinical_notes.subjective/objective/assessment/plan`. El modelo queda parametrizable (env var), no hardcodeado.
- **Sin evidencia suficiente:** la nota SOAP se genera igual del transcript, **sin literatura** (`insufficient_evidence=true`).

## 7. Qué NO asumir (errores a evitar)
- El frontend **no** habla directo con el motor de IA para recuperar: **todo pasa por Athos**.
- Nada de **bypass de RLS**; `clinic_id` siempre explícito.
- La nota **siempre es `draft`** hasta que el vet aprueba.
- **No hardcodear** proveedores/modelos de IA (van por variable de entorno).
- El corpus y el glosario son **globales**; **nunca** se mezclan con datos de paciente en la DB.

## 8. Decisiones cerradas (para que no re-pregunten)
- **Tenancy:** compartido + `clinic_id` + RLS.
- **LLM redacción:** Claude Sonnet 5 (validar Opus 4.8 en el golden set). **Liviano:** Haiku 4.5.
- **Embeddings:** **Cohere embed-v4** (multilingüe, cross-lingual ES→EN, dim 1024). Rerank: Cohere Rerank.
- **Corpus:** 61.544 documentos (validados, en inglés). El **glosario** es el puente ES→EN.
- **Ubicación:** Athos en **Railway**; DB en **Supabase**; front en **Vercel**; Phantom lo hace Pipe.

## 9. Dónde está el detalle
- Diseño completo del RAG: `tuvetia_rag_documento_final.md` (misma carpeta)
- Reglas para Claude Code: `../CLAUDE.md`
- Montaje del microservicio paso a paso: `../SETUP.md`
- Entornos y migraciones (dev → PR → principal): `MIGRACIONES.md`

## 10. Bitácora de montaje y decisiones (se actualiza)
> Registro vivo del progreso del microservicio, para que Santiago y Pipe sigan el avance y las decisiones. Última actualización: **2026-07-13**.

**2026-07-13 — Entorno local montado y verificado**
- Herramientas: `uv`, Node 22, Git, Claude Code, **Supabase CLI 2.109.1**.
- `.venv` con dependencias (FastAPI, psycopg, pgvector, anthropic, cohere, llama-index…); `GET /health` responde `200`; `ruff` y `pytest` en verde (los tests del RAG aún son *stubs* a la espera de la implementación).
- Repo Git inicializado (commits locales). **Aún sin push**: esperamos a definir la estructura final del repo.

**2026-07-13 — Metodología de entornos y migraciones (DECIDIDA)**
- El RAG se desarrolla en un proyecto Supabase **separado** (`tuvetia-athos-dev`), **nunca** contra el proyecto principal/compartido.
- **`supabase/migrations/`** es la única fuente de verdad; el esquema fluye **dev → PR → principal** con el CLI de Supabase (`supabase db push`), aplicando **los mismos archivos**. Sin copiar bases ni recrear tablas generales.
- El esquema **base** del principal se replica en dev **solo** vía `../supabase/bootstrap/` (lo aporta el equipo).
- El MCP de Supabase se **repuntará a dev**; el principal nunca queda escribible por MCP.
- Runbook: `MIGRACIONES.md`. Reglas duras: `../CLAUDE.md` → *Entornos y migraciones*.

**2026-07-13 — Entorno dev conectado y migración `0001` aplicada**
- Proyecto `tuvetia-athos-dev` (ref `ghmpjyuchwkrvnjvdeum`) conectado por el **session pooler** (puerto 5432). MCP repuntado a dev (read-only).
- El esquema **base ya estaba aplicado** en dev (19 tablas + `private.my_clinic_id()`).
- Migración **`0001` aplicada** con `supabase db push` (registrada en `schema_migrations`). Se crearon `glossary_*`, `athos_messages`, `rag_*`; `corpus_chunks.embedding` → `vector(1024)`.
- **Pendientes a coordinar con el equipo (para el PR a main):**
  - **Dimensión de embeddings:** el base crea `corpus_chunks`/`patient_embeddings` a **1536**; la decisión cerrada es **1024** (Cohere embed-v4). En main hay que alinear a 1024 (re-embeddear si ya hay datos).
  - **Índice vectorial:** DECIDIDO **HNSW** (mayor calidad/robustez a largo plazo) en migración **`0002`**, reemplazando el ivfflat del base en `corpus_chunks` y `patient_embeddings`. Afecta tablas generales → **coordinar con el equipo** antes de aplicar a main (rebuild si ya hay datos).
  - **Auth/JWT:** el proyecto expone **JWKS** (firma asimétrica); `app/auth.py` hoy verifica HS256 con el JWT secret. Reconciliar al implementar la auth real.

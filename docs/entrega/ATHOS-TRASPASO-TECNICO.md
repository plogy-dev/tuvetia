# Athos — Documentación técnica de traspaso

**Corte:** 2026-08-21 · **Repo:** `plogy-dev/tuvetia` @ `master` (`d56a216`) · **Alcance:** todo lo que tenga que ver con Athos — el microservicio RAG, el agente de Next, el Modo Fantasma, la transcripción, el modelo de datos, la ingesta del corpus, los entornos y la operación.

> Este documento está escrito para que una persona que nunca tocó el proyecto pueda entender **cómo está construido todo, dónde está cada variable, de qué depende cada cosa y cuál es la lógica detrás de cada decisión**. Cada afirmación sale del código real (se citan `archivo:línea` cuando importa). La versión didáctica de este mismo contenido está en `ATHOS-DOCUMENTACION.html` (misma carpeta).

---

## Índice

1. [Lo primero: hay DOS "Athos"](#1-lo-primero-hay-dos-athos)
2. [Arquitectura, repos y despliegue](#2-arquitectura-repos-y-despliegue)
3. [Entornos: qué apunta a dónde](#3-entornos-qué-apunta-a-dónde)
4. [El backend `athos-service` (FastAPI/Railway)](#4-el-backend-athos-service)
5. [La cascada de retrieval](#5-la-cascada-de-retrieval)
6. [El glosario (puente ES→EN)](#6-el-glosario)
7. [Generación y seguridad clínica (gates y auditores)](#7-generación-y-seguridad-clínica)
8. [El chat clínico (`/athos/chat`) paso a paso](#8-el-chat-clínico-paso-a-paso)
9. [El Modo Fantasma (`/athos/phantom/suggest`) paso a paso](#9-el-modo-fantasma-paso-a-paso)
10. [Transcripción: por lotes, en vivo y roles de hablante](#10-transcripción)
11. [Contexto y memoria de paciente](#11-contexto-y-memoria-de-paciente)
12. [El agente de Next (`src/lib/athos-agent`)](#12-el-agente-de-next)
13. [El frontend de Athos](#13-el-frontend-de-athos)
14. [Modelo de datos y migraciones](#14-modelo-de-datos-y-migraciones)
15. [Ingesta del corpus](#15-ingesta-del-corpus)
16. [Variables de entorno — referencia completa](#16-variables-de-entorno)
17. [Operación: deploy, calidad y metodología de medición](#17-operación)
18. [Deuda técnica y huecos conocidos (consolidado)](#18-deuda-técnica-y-huecos-conocidos)
19. [Índice de documentación existente](#19-índice-de-documentación-existente)

---

## 1. Lo primero: hay DOS "Athos"

El error más caro que puede cometer quien recibe este proyecto es confundir dos sistemas distintos que comparten nombre:

| | **Athos-service (RAG clínico)** | **Agente Athos (en Next)** |
|---|---|---|
| Dónde corre | FastAPI en **Railway** (`skeleton/athos-service/`) | Route handlers de **Vercel** (`/api/athos/*`) |
| Quién lo llama | El **navegador**, directo (CORS) | El navegador llama a Next; Next llama al modelo |
| URL base | `NEXT_PUBLIC_ATHOS_URL` | relativa (`/api/athos/agent`) |
| Auth | `Authorization: Bearer <JWT de Supabase>` | cookie de sesión Supabase (SSR) |
| Qué hace | Chat clínico con literatura citada (SSE), nota SOAP del Fantasma, transcripción, retrieval | Asistente con 22 herramientas: consulta datos de la clínica y **propone** acciones que el vet aprueba |
| Motor | LLM del backend por env vars de Railway + Cohere | `@ai-sdk/*` (Anthropic / DeepSeek / Google) por env vars de Vercel |
| Cliente en el front | `src/lib/athos.ts`, `src/lib/athos-live.ts` | `useChat` de `@ai-sdk/react` |

El **único punto de contacto** entre ambos: la tool `search_clinical_evidence` del agente hace `POST {NEXT_PUBLIC_ATHOS_URL}/athos/retrieve` (server-side, con el `access_token` del vet, timeout 20 s).

**Superficies visibles para el usuario:**

| Superficie | Motor | ¿Tiene tools? |
|---|---|---|
| `/dashboard/asistente` (pantalla "Athos") | `/api/athos/agent` (Next, AI SDK) | sí, las 22 |
| Burbuja/widget global (toda la app) | `/api/athos/agent` con `source: "widget"` | sí |
| Botón "Sugerir" de la bandeja WhatsApp | `/api/athos/suggest-reply` | sí |
| Onboarding | `/api/athos/agent` con `source: "onboarding"` | sí |
| Chat dentro de la consulta ("Hilo de la consulta") | `POST /athos/chat` (Railway, SSE) | no — RAG puro |
| Nota del Modo Fantasma | `POST /athos/phantom/suggest` (Railway) | no — RAG puro |

**Filosofía compartida** (impuesta por código, no por prompts):
1. **Cita o se calla** — sin evidencia suficiente, lo declara; nunca inventa fuentes (no están representadas en el camino de datos: el modelo solo elige un `chunk_id`, el código reconstruye la cita desde el corpus).
2. **Lenguaje de posibilidad** — nunca diagnóstico definitivo.
3. **Gate de alergia severa** determinístico, desde la tabla `allergies`, antes de cualquier plan.
4. **Sin dosis si faltan datos** (especie, peso, edad) — lo impone `dose_guard.py`, no el prompt (medido: el prompt fallaba 2/23 y con un prompt más resolutivo 9/23).
5. **Aprobación humana** — ninguna nota entra a la historia y ninguna acción se ejecuta sin que el vet apruebe.
6. **Aislamiento por clínica** — corpus y glosario son globales; datos de paciente por clínica con RLS; nunca JOIN entre ambos mundos.
7. **Mínima IA** — retrieval determinístico (glosario + SQL + pgvector); el LLM solo entiende la consulta (A→B) y redacta (B→A).

---

## 2. Arquitectura, repos y despliegue

```
    navegador (vet)
        │
        ├────────────────────────► VERCEL  (front Next.js, raíz de skeleton/)
        │    cookie de sesión         │  /api/athos/agent  → agente (22 tools) ─┐
        │                             │  /api/athos/actions/[id]/execute        │ tool search_clinical_evidence
        │                             │  /api/whatsapp/* · /api/cron/*          │
        │  Bearer JWT                 ▼                                         ▼
        └────────────────────────► RAILWAY (athos-service, FastAPI)  ◄──── POST /athos/retrieve
                                      │  /athos/chat (SSE) · /athos/phantom/suggest
                                      │  /athos/transcribe (+ /live WS) · /health
                                      ▼
                     SUPABASE (Postgres + pgvector, proyecto principal)
                     Global: corpus_chunks (520k), glossary_*
                     Por clínica (RLS): patients, allergies, consultations,
                       transcripts, clinical_notes, athos_actions, athos_messages,
                       rag_retrieval_log, rag_answer_log, patient_embeddings, ...
                     Storage: consultation-audios, patient-attachments
```

- **Monorepo** `plogy-dev/tuvetia`, rama `master` = lo que está en vivo. Front Next en `skeleton/` (raíz del repo), backend en `skeleton/athos-service/`.
- **Vercel**: proyecto `tuvetia`, dominio `https://tuvetia.vercel.app`. Git-connected: cada merge a `master` despliega solo.
- **Railway**: `https://athos-service-production.up.railway.app`. Root Directory `athos-service/`, `watchPatterns=athos-service/**`. Build NIXPACKS + `requirements.txt` (Python 3.12); arranque `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (un solo worker); healthcheck `/health` (timeout 100 s, restart ON_FAILURE máx. 3). También hay un segundo servicio Railway con **Evolution API** (WhatsApp no oficial) y su propio Postgres.
- **No hay proxy** entre front y backend: el navegador habla con Railway directo. Por eso `NEXT_PUBLIC_ATHOS_URL` es pública y el backend declara `CORS_ORIGINS` con el dominio de Vercel.
- **Regla de despliegue**: nunca `vercel deploy --prod` a mano; todo por git (`fetch` → feature branch → PR → merge a `master`). Cambiar una env var NO redespliega solo.
- ⚠️ El checkout `C:\DevsJesus\tuvetia\athos-service\` (raíz, fuera de `skeleton/`) está **DEPRECATED** — código viejo sin remote. No editarlo (ver su `_DEPRECATED.md`).

---

## 3. Entornos: qué apunta a dónde

| Pieza | Valor |
|---|---|
| Supabase **principal / producción** | ref `auxlnexhkmtoedrzfsnz` — datos de paciente, trazas **y el corpus completo** (61.544 docs / ~520.000 chunks; ampliación en curso, ver §15) |
| Supabase **dev** | `tuvetia-athos-dev`, ref `gdiiagioiukadifejewv` (us-west-2; recreado 2026-07-31 — el anterior fue borrado) |
| Vercel | org `team_YuPR17pYDA7abruvSfheldS9`, proyecto `tuvetia` |
| Railway (Athos) | `athos-service-production.up.railway.app` |
| MCP de Claude | apunta al principal con `read_only=true` (los dos `.mcp.json`) |

**La regla en una línea:** *lo que solo lee puede mirar producción; lo que escribe, nunca.*

- `.env` local de cada dev (datos de paciente) → **dev**. Credenciales del principal solo en CI/secretos.
- El **corpus** es la excepción de lectura: solo vive completo en el principal, así que mediciones de calidad leen de ahí.
- **Cortafuegos en código** (`app/db.py:21-68`): bajo pytest, abrir la DB de *paciente* del principal (`REF_PRINCIPAL = "auxlnexhkmtoedrzfsnz"`) lanza `RuntimeError`, salvo la escotilla `PERMITIR_TESTS_CONTRA_EL_PRINCIPAL=si-se-lo-que-hago`. El corpus queda deliberadamente fuera del veto. Existe porque el 2026-07-30 la suite (que crea y borra clínicas) llegó a correr contra producción a través de mocks; el guard corta en el único punto por el que pasa todo: abrir la conexión.
- **Tres almacenes de variables** distintos: Vercel (front + agente), Railway-athos (backend), Railway-Evolution. Una variable en el lugar equivocado **no da error: simplemente no hace nada**. `CRON_SECRET` vive además en GitHub Actions Secrets.

---

## 4. El backend `athos-service`

### 4.1 Estructura

```
athos-service/
├── app/
│   ├── main.py                  # app FastAPI, CORS, 7 endpoints
│   ├── config.py                # Settings (pydantic-settings) — TODAS las env vars
│   ├── db.py                    # 2 pools psycopg (paciente / corpus) + cortafuegos
│   ├── auth.py                  # verify_jwt (JWKS/HS256) + resolve_clinic_id
│   ├── models.py                # contratos Pydantic + constantes EVIDENCE_*
│   ├── chat.py                  # chat SSE completo
│   ├── phantom.py               # Modo Fantasma
│   ├── transcription.py         # ASR por lotes (Deepgram)
│   ├── streaming_transcription.py  # ASR en vivo (WebSocket)
│   ├── speaker_roles.py         # inferencia vet/titular (determinística)
│   ├── patient_context.py       # ficha del paciente (3 queries)
│   ├── patient_memory.py        # memoria semántica por paciente
│   ├── whatsapp_reply.py        # borrador de respuesta (hoy huérfano)
│   ├── embeddings.py            # cliente Cohere embed-v4.0 (dim 1024)
│   ├── retrieval/               # cascade.py · query_builder.py · rerank.py
│   ├── glossary/                # resolve.py · seed.py · specificity.py · data/
│   ├── generation/              # generate, llm_client, provider_cascade, gates y auditores
│   ├── ingestion/               # pipeline.py · run.py (CLI)
│   └── trace/logs.py            # athos_messages · rag_retrieval_log · rag_answer_log
├── supabase/migrations/         # 64 archivos — LA fuente de verdad del esquema propio
├── supabase/bootstrap/          # esquema base (solo para levantar dev)
├── scripts/                     # eval_golden.py + calidad/ (33 scripts)
├── tests/                       # ~250 tests; golden/ con los bancos
├── railway.json · Procfile · requirements.txt · pyproject.toml
```

### 4.2 Endpoints (contrato)

Auth común (salvo `/health`): `Authorization: Bearer <JWT Supabase>` → `verify_jwt` extrae `sub` → `resolve_clinic_id(user_id, clinic_id)` verifica `select 1 from profiles where id=… and clinic_id=… and is_active` (403 si no pertenece; **`profiles.is_active` es dependencia dura**). El `clinic_id` lo propone el cliente y el servidor lo confirma contra la membresía.

| Endpoint | Body | Devuelve |
|---|---|---|
| `GET /health` | — | `{"status":"ok","service":"athos"}` |
| `POST /athos/chat` (SSE) | `{question, patient_id?, clinic_id}` | eventos `warning` / `token` / `done` (ver §8). `patient_id=null` = consulta general (sin ficha, memoria ni traza) |
| `POST /athos/phantom/suggest` | `{consultation_id, clinic_id}` | `{note_id, status:"draft", soap{...}, allergy_gate_triggered, allergy_transcript_flag, insufficient_evidence, evidence_level, citations[], alerts[], unsupported_claims[], ai_model, ai_generated_at}` |
| `POST /athos/retrieve` | `{clinic_id, question, species?, patient_id?}` | `{passed, evidence_level, chunks[≤8]}` con `excerpt` de 600 chars. **El consumidor debe leer `evidence_level`, no `passed`** (saturado: True en 187/187 medidos). Traza siempre con `source='agent'` |
| `POST /athos/transcribe` | `{consultation_id, clinic_id}` | `{transcript_id, full_text, stt_model}` |
| `WS /athos/transcribe/live` | protocolo `init → ready → audio → text… → stop → stopped → finalize → saved` | el JWT viaja en el mensaje `init` (el navegador no puede poner cabeceras en un WebSocket) |
| `POST /athos/whatsapp/suggest` | `{clinic_id, owner_name?, messages[]}` | `{draft}` — **endpoint vivo pero sin consumidor** (la bandeja usa el agente de Next) |

El endpoint `POST /ingest` **fue eliminado** (stub público, hallazgo de seguridad 2026-07-28); la ingesta corre por CLI.

- `evidence_level ∈ {none, limited, sufficient}`; `insufficient_evidence ≡ (evidence_level == "none")` (se mantiene por compatibilidad).
- Citas: `{chunk_id, doc_id, locator, source, url, title, year}` — reconstruidas **desde el corpus** con `Citation.from_chunk` (`models.py:29-42`), no desde lo que escriba el LLM.
- Errores hacia el vet: los `detail` de FastAPI se muestran en toasts; nunca nombran proveedores (el front además los tacha con `sinNombresDeProveedor()`).

### 4.3 Autenticación en detalle (`app/auth.py`)

- `verify_jwt` enruta por el `alg` del header: asimétricos (`ES256`, `RS256`, …) → JWKS del principal (`SUPABASE_JWKS_URL` o derivada de `SUPABASE_URL`, cliente cacheado por proceso); `HS256` → `SUPABASE_JWT_SECRET` (legacy). Audience `authenticated`. El principal firma **ES256**.
- `truststore.inject_into_ssl()` al importar: la red de dev intercepta TLS (proxy MITM) y la CA del SO debe valer para `urllib`/httpx/SDKs. La misma técnica se reusa en `embeddings.py`, `rerank.py` y `llm_client.py` (`_tls_context()`).
- El servicio conecta a Postgres con **service_role → se salta RLS** → toda query del lado paciente lleva `clinic_id` explícito (cubierto por tests cross-tenant). Un paciente de otra clínica devuelve contexto vacío, no error.

### 4.4 Base de datos (`app/db.py`)

- **Dos pools** (`ConnectionPool`, min 1 / max 10 / max_idle 300): `_pool` → `DATABASE_URL` (paciente + trazas); `_corpus_pool` → `CORPUS_DATABASE_URL` o, si vacía, la misma `DATABASE_URL`. Hoy en producción ambas apuntan al principal.
- `statement_timeout=15000` (15 s) en todas las conexiones — es el techo que obligó a separar las dos ramas del Tier 1 (§5).
- `_exigir_url`: una URL vacía lanza de inmediato (antes, libpq caía a `localhost` y el fallo se manifestaba como lentitud, no como error).
- `get_conn()` / `get_corpus_conn()`: conexión **fuera del pool** para transacciones propias (nota del Fantasma, ingesta con `statement_timeout=0`).
- Helpers: `fetch_all`, `fetch_all_corpus`, `execute`, `execute_corpus` (commit al salir del context manager).

---

## 5. La cascada de retrieval

**Camino de producción:** `build_and_retrieve(text, species)` (`app/retrieval/cascade.py:325`) — lo usan chat, Fantasma y `/athos/retrieve`. Devuelve `(StructuredQuery, chunks, passed)`.

**Truco central de latencia:** el Tier 2 vectorial embebe el **texto crudo** (no necesita conceptos), así que se lanza en un `ThreadPoolExecutor` **antes** del A→B y ambos corren solapados (distilación ~4,3 s + retrieval ~4,4 s en serie → ~máx de ambos).

### Paso 0 — A→B (consulta → conceptos)  `query_builder.py`

1. `resolve_concepts(text, species)` — glosario determinístico, 0 tokens (§6).
2. `_glossary_is_confident`: exige `≥ MIN_CONFIDENT_CONCEPTS = 3` conceptos **y** que alguno nombre una *condición concreta* (`names_a_condition` contra `mesh_diagnostic.json`, 994 descriptores — tres signos genéricos no son un diagnóstico).
3. Si no es confiable → `distill_query` con el **modelo liviano** (`LLM_LIGHT_MODEL`, `max_tokens=400`, texto recortado a 4000 chars, salida `concepts[:12]` + `mesh[:12]`). Ante cualquier error devuelve vacío (el A→B nunca rompe).
4. Fusión **aditiva** (nunca reemplaza al glosario) + `distilled=True`.

### Paso 1 — Tier 0: filtros y boosts (gratis)

- La especie es **preferencia, no exclusión** (63% del corpus es "mixto"): `SPECIES_MESH` mapea `gato→[Cats, Cat Diseases]`, etc.
- `TIER1_MESH_STOPLIST` (22 descriptores: `Dogs`, `Cats`, `Animals`, …) se quita del criterio temático — `Dogs` está en 43.033 chunks y reventaba el `statement_timeout` además de inflar el umbral.
- Scoring determinístico: `score = base + 0.15 especie + 0.05·min(∩mesh,3) + 0.05 is_current + tier(A:0.05/B:0.02/C:0)`.

### Paso 2 — Tier 1: léxico + MeSH (SQL, gratis)

`TIER1_SQL` con **dos ramas separadas** unidas por `union all` (una por `metadata->'mesh' ?| conceptos`, otra por full-text `tsv @@ websearch_to_tsquery`): la versión con `or` tardaba 15 s de servidor sobre 520k chunks (rankeaba ~19k filas antes del LIMIT); separadas, 42 ms con los mismos 40 chunks. Caps: `TIER1_MESH_SCAN_CAP=20000`, `TIER1_FTS_SCAN_CAP=3000`, `TIER1_LIMIT=40`. Bases: mesh_hit=0.6, léxico=0.4, micro-desempate `min(lex,0.999)*0.001`. Índices: `corpus_chunks_mesh_gin` (GIN de expresión, migración 0003: 44 s → 2 s) y `corpus_chunks_tsv_idx`.

### Paso 3 — Tier 2: vectorial (SIEMPRE, no fallback)

- `_query_vector_cached` (`@lru_cache(256)`) → Cohere `embed-v4.0`, `input_type="search_query"`, dim 1024, timeout 6 s → pgvector coseno sobre índice **HNSW**, `TIER2_LIMIT=40`.
- Corre en **toda** consulta desde la calibración 2026-07-22: el Tier 1 puede ser *fuerte pero off-topic* (hipertiroidismo felino: 0/8 chunks de tiroides en Tier 1, 8/8 en Tier 2). Golden 10/11 → 11/11 estable. Costo ~US$0,0006/consulta.
- Degrada con gracia: cualquier `EmbeddingError` → se sigue solo con Tier 1.

### Paso 4 — Fusión, umbral y rerank  (`_fusionar`)

1. Merge con tope por modalidad: `tier1[:24] + tier2[:16]` = máx. 40 (para que lo léxico incidental no sepulte lo semántico).
2. `passes_threshold`: `max(score) ≥ THRESHOLD = 0.35`, evaluado **ANTES** del rerank a propósito (activar/desactivar el reranker cambia *qué* literatura llega, nunca *cuándo* se abstiene). ⚠️ Está **saturado** (True en 187/187): quedó como filtro barato; la abstención real es el juez.
3. **Rerank Cohere** (`rerank.py`): `POST /v2/rerank`, modelo `rerank-v3.5`, deja **15** de 40, timeout 4 s, docs a 4000 chars. Sin rerank, `precision@15 ≈ 19%`; con él, el target en top-15 pasó de 37,8% → 69,7% (golden de 146 casos). Degrada en silencio ante cualquier fallo (⚠️ sin log).

### Paso 5 — Juez de evidencia  (`generation/evidence_judge.py`)

El umbral no discrimina (score 1.701 en positivos vs 1.700 en negativos), así que un **LLM liviano lee los 6 mejores pasajes** (700 chars c/u) y puntúa 0-10 → banda:

- `≤ JUDGE_ABSTAIN_MAX=2` → **`none`** (abstención dura)
- `≤ JUDGE_LIMITED_MAX=6` → **`limited`** (se responde declarando evidencia limitada)
- `7-10` → **`sufficient`**

**Corroboración determinística** (gratis): ¿algún descriptor MeSH *diagnóstico* del A→B está indexado en la literatura? FRENO (`sufficient` sin corroborar y score ≤ 9 → `limited`) y RESCATE (`none` corroborado → `limited`). Calibración medida sobre 188 casos: cortes 2/6 + corroboración = seguridad 92,6% / utilidad 65,5% (94,5% en la mitad no vista). **Falla abierta** (error/timeout → `sufficient`, `judged=False`). En el **chat** corre en paralelo con la redacción (deadline 4 s); en el **Fantasma**, antes de generar.

### Dónde alimenta cada cosa

- Chat: `literature = chunks[:12]` (`CHAT_LIT_LIMIT`), cada chunk a 1200 chars.
- Fantasma: los 15 post-rerank completos.
- `/athos/retrieve`: los primeros 8, con extracto de 600 chars.
- Traza: `rag_retrieval_log` con `source ∈ {chat, phantom, agent}`, `query_used[:1000]`, `concepts`, `chunk_ids` (post-rerank), `top_score` (determinístico), `passed`.

---

## 6. El glosario

Es el puente **español → inglés/MeSH** y el activo que más determina la calidad del retrieval. Global (sin `clinic_id`), vive en la DB del corpus.

- **Tablas** (migración 0001): `glossary_term` (`canonical_en`, `mesh_id`, `category`, `review_status`), `glossary_synonym` (`term_id`, `text`, `lang`, `register`, `origin`, `review_status`, índice sobre `lower(text)`), `glossary_relation` (⚠️ creada y **jamás usada**).
- **`approved` vs `candidate`**: el retrieval usa **exclusivamente sinónimos `approved`** (`resolve.py`). Sembrar como `candidate` es inerte — es la perilla de seguridad de toda la curación.
- **Resolución** (`resolve.py`): normaliza (NFKD, sin acentos, `ñ→n`, solo `[a-z0-9 ]`) y matchea **frases completas** con límites de palabra. Caché en memoria con TTL **300 s** (+ `clear_synonym_cache()`).
- **Especificidad** (`specificity.py` + `data/mesh_diagnostic.json`, 994 descriptores): un MeSH de la rama C sin C23 = condición concreta; C23 = signo. Decide si el A→B distila.
- **Siembra** (`seed.py`, CLI `python -m app.glossary.seed`): `CURATED` = 41 términos / 218 sinónimos ES coloquiales ("toma mucha agua"→Polydipsia) que se aprueban directo; `seed_from_corpus_mesh()` crea un term+sinónimo EN `candidate` por cada MeSH del corpus; `seed_from_decs()` → `NotImplementedError` (hueco conocido).
- **Curación por tandas** (`scripts/calidad/glosario_*.py` — los únicos scripts que **escriben** a la DB): generar propuestas ES con LLM → validar con 5 guardas determinísticas (frecuencia del MeSH, ambigüedad, longitud, colisiones, choque con lo curado) → sembrar `candidate` → medir con `glosario_gate.py` (¿la tanda hace que consultas se salten la distilación?) → aprobar tanda → re-medir → posibilidad de revertir por `origin='es_llm_mesh'`. Estado: ~150 descriptores / 521 sinónimos aprobados en tanda 1; ~2.100 en `candidate`.
- **Riesgos de ampliarlo** (documentados): `MIN_CONFIDENT_CONCEPTS=3` hace que un glosario más rico pueda *saltarse* la distilación que habría inferido el síndrome; sinónimos-subcadena ambiguos envenenan el retrieval de todos.

---

## 7. Generación y seguridad clínica

### 7.1 Cliente LLM y cascada de proveedores

**`llm_client.py`** — tres ramas por `LLM_PROVIDER`: `anthropic` (SDK oficial, **prompt caching** en el system — único punto de caching del servicio), `openai`-compatible (DeepSeek/Kimi vía httpx directo a `{LLM_BASE_URL}/chat/completions`, timeout 120 s, ignora `reasoning_content`), `google` (endpoint OpenAI-compatible de Gemini; cuerpo sin `thinking` — lo rechaza con 400 — y por eso necesita `max_tokens` holgado). `RespuestaVaciaError` si el contenido llega vacío o cortado por `length`.

**`provider_cascade.py`** — cascada config-driven con tres tareas ruteables:

| Tarea | Env var | Quién la usa |
|---|---|---|
| `REDACCION` | `LLM_CASCADE_REDACCION` | chat + nota del Fantasma |
| `LIVIANO` | `LLM_CASCADE_LIVIANO` | juez de evidencia (con `JUDGE_MODEL` como primario opcional) |
| `DIFICIL` | `LLM_CASCADE_DIFICIL` (cae a REDACCION) | nota del Fantasma cuando la banda es `limited` (**solo Fantasma**: en el chat el juez corre en paralelo y esperar costaría ~1,8 s de primer token) |

Formato `"modelo@proveedor,modelo@proveedor"`, tope `LLM_CASCADE_MAX_INTENTOS=3`. Lista blanca `{openai, google, anthropic}` (un typo `gemini` mandaría la key de DeepSeek a Anthropic). Filtra candidatos sin credencial propia (`ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `LLM_API_KEY`). En **streaming**, la alternativa solo entra si el fallo ocurre **antes del primer token** (nunca coser dos respuestas). El modelo que respondió DE VERDAD queda en un `ContextVar` → `clinical_notes.ai_model` y `rag_answer_log.model` registran `modelo@proveedor` real.

**Valores de producción** (Railway, auditoría 2026-07-30):
```
LLM_CASCADE_REDACCION = deepseek-v4-flash@openai,gemini-3.6-flash@google,claude-sonnet-5@anthropic
LLM_CASCADE_DIFICIL   = claude-sonnet-5@anthropic,deepseek-v4-flash@openai,gemini-3.6-flash@google
LLM_CASCADE_LIVIANO   = deepseek-v4-flash@openai,gemini-2.5-flash-lite@google,claude-haiku-4-5@anthropic
LLM_PROVIDER=openai · LLM_BASE_URL=https://api.deepseek.com · LLM_MODEL=deepseek-v4-flash
```
(DeepSeek es el proveedor elegido por el cliente por costos; los defaults de `config.py` — `claude-sonnet-5` / `claude-haiku-4-5` — son solo defaults.)

Los tres **auditores** (fidelidad de citas, fidelidad de nota, alertas) usan `LLMClient` directo sin cascada: son control de calidad, fallan abierto por contrato.

### 7.2 Gates y auditores (en orden de ejecución)

| Pieza | Tipo | Qué hace | Claves |
|---|---|---|---|
| **Gate de alergia severa** (`allergy_gate.py`) | determinístico | Lee `allergies` con `severity='severe'` (clinic_id explícito). Marca `allergy_gate_triggered`, inyecta los alérgenos en el prompt ("ADVERTIR antes de cualquier plan") y en el chat emite un `warning` antes del primer token. En el front **bloquea la aprobación** (checkbox + trigger 0054 en DB) | nunca depende del LLM |
| **Backstop de alergia en transcript** | determinístico | `transcript_mentions_allergy`: regex ES+EN (`alerg|allerg|hipersensibil|anafilax…`) con ventana de negación de 3 palabras; se OR-ea con el flag del modelo → `allergy_transcript_flag` | una alergia dicha en consulta no se pierde aunque no esté en `allergies` |
| **Gate de dosis** (`dose_guard.py`) | determinístico | Si falta especie, peso **o** edad: tapa la cifra (`mg/kg` y variantes, rangos, decimales) con `[dosis omitida: falta peso/edad del paciente]` — conserva fármaco/vía/frecuencia. En el chat con colchón de emisión `STREAM_TAIL=48` chars para que el stream no parta la cifra; lo persistido va ya redactado | solo cubre dosis **por peso**; "500 mg cada 12 h" es hueco conocido |
| **Verificación de procedencia** (`citations.py`) | determinístico | Un `chunk_id` citado que no está en lo recuperado se descarta (fuente inventada); dedup; la cita se reconstruye desde el corpus | el modelo solo elige el id |
| **Fidelidad de citas** (`citation_fidelity.py`) | LLM liviano | ¿El pasaje citado SOSTIENE lo afirmado? Existe porque la procedencia no alcanza (18/24 respuestas citaban ≥1 pasaje que no respaldaba). Corre **después** de la respuesta. Fantasma: `drop_and_renumber` (el `[n]` indexa `citations`); chat: `done.unverified_sources` + persistencia sin esos marcadores | calibrado: descarta 18% (era 58%); interruptor `FIDELITY_ENABLED` |
| **Fidelidad de nota** (`transcript_fidelity.py`) | mixto | S/O contra el transcript. (a) señal determinística `conceptos_agregados` (dif de conjuntos del glosario); (b) **reparación** `repair_sections` (reescribe con las palabras de la consulta; se rechaza si acorta >40% o no mejora — medido: términos sin respaldo 28→4); (c) señalamiento `check_note_fidelity` → `unsupported_claims` (NO modifica la nota: borrar por veredicto de un LLM podría sacar un hallazgo real del expediente) | 17/40 notas afirmaban hechos que la consulta no contiene; el auditor solo atrapa 3/9 — "red parcial, no auditoría completa" |
| **Afirmaciones sin declarar** (`undeclared.py`) | determinístico | Fármacos (por terminación: `-azol`, `-micina`, `-ciclina`… + lista) y cifras ejecutables sin cita `[n]` y sin la marca "criterio clínico" → informa (`undeclared_claims` / sección A/P de `unsupported_claims`), no censura | calibrado a "solo lo ejecutable": 30 casos en 34 respuestas |
| **Alertas de condición** (`condition_alerts.py`) | mixto | Catálogo curado de **11 condiciones** (diabetes, ERC, hipertiroidismo…) detectadas determinísticamente en el assessment → `alerts[]` con `severity` info/warning (**nunca bloqueante**) + panel "afectaciones en este paciente" generado por el liviano (grounded en la literatura; `detail=null` si falla) | se persiste en `clinical_notes.alerts` (0004) |

### 7.3 Prompts

- **`CLINICAL_SYSTEM_PROMPT`** (nota): rol clínico + reglas duras + citación *permisiva* ("la literatura YA fue filtrada por relevancia; basta un chunk pertinente" — la severidad la pone el auditor después) + marcado inline `[chunk_id]` + salida JSON estricta + evaluar el flag de alergia SIEMPRE.
- **`CHAT_SYSTEM`** (chat): prompt de **clínico que decide**, no resumidor — impresión priorizada → siguiente paso concreto → criterios de alarma; lo que no está en la literatura se declara "Criterio clínico". Regla 8: identidad Athos (no nombrar modelos/proveedores). Medido: 15-0 contra el anterior; "un vet experimentado seguiría esto" 3/23 → 13/23.
- El prompt del vet incluye el **cuaderno** (`consultations.notebook`, migración 0058) con la regla "ante contradicción con lo hablado, PRIMAN estas notas".

---

## 8. El chat clínico paso a paso

`stream_answer` (`app/chat.py:163-382`), SSE con eventos `warning` / `token` / `done`:

1. `load_patient_context` (o contexto vacío si es consulta general).
2. `build_and_retrieve` (§5, con Tier 2 solapado).
3. **Memoria del paciente**: `recall()` reusa el vector cacheado del Tier 2 (cero costo extra) → hasta 5 snippets; en paralelo un hilo daemon indexa lo pendiente (`index_patient_memory`).
4. Alergias severas → evento `warning` inmediato si hay.
5. Historial del hilo: últimos 8 turnos de `athos_messages` (hilo implícito por `clinic_id+patient_id`; no hay `thread_id`).
6. Traza (`log_message` + `log_retrieval`) en hilo background — solo con `patient_id`.
7. Si `not passed` → `_abstain` (plantilla sin LLM) y fin.
8. **Juez en paralelo** (hilo + `Event`, deadline `JUDGE_CHAT_TIMEOUT_S=4.0`): los tokens del stream quedan **retenidos** hasta el veredicto. `none` → se corta el stream y se descarta lo retenido (el vet nunca ve texto que haya que desdecir); `limited` → `warning` con `LIMITED_NOTICE` antes del primer token; timeout → se responde igual.
9. Stream de `ProviderCascade(REDACCION)` (`max_tokens=3000`), con el gate de dosis aplicado a cada trozo emitido (colchón 48 chars) y `DOSE_NOTICE` una sola vez.
10. Post-respuesta: `check_fidelity` (no suma latencia al primer token) → citas honestas (`_cited_from_answer`, solo los `[n]` realmente usados, menos los infieles) → persistencia de **lo que el vet debería haber visto** (dosis tapadas, marcadores caídos quitados) → `find_undeclared`.
11. `done`: `{citations, allergy_gate_triggered, insufficient_evidence, evidence_level, ai_model, unverified_sources, undeclared_claims}`.

---

## 9. El Modo Fantasma paso a paso

### 9.1 Backend (`phantom.py:124-251`)

1. Carga consulta (404 si no es de la clínica) y **último** transcript; sin transcript, la nota se redacta desde `chief_complaint` (y `transcript_id` queda NULL).
2. `load_patient_context` (⚠️ sin `query_vector`: el Fantasma **no usa** la memoria semántica del paciente — solo el chat).
3. `build_and_retrieve(transcript, especie)`.
4. **Gate de alergia** (`evaluate_gate`).
5. **Juez ANTES de generar** (el Fantasma es asíncrono; su banda decide el routing: `limited` → cascada `DIFICIL`).
6. `generate_note`: **una sola llamada** (`max_tokens=4000`, hasta 2 intentos; nota vacía → `EmptyNoteError` → **502 sin insertar fila** — antes se insertaban notas en blanco).
7. Parseo determinístico: JSON tolerante → `verify_citations` → rescate de citas inline por UUID → **renumeración a `[n]`** en las 4 secciones.
8. Post-proceso: dose guard (plan+assessment) → fidelidad de citas (`drop_and_renumber` + filtrado de `citations`) → `repair_sections` (S/O) → `check_note_fidelity` (señala) → `find_undeclared` (A/P).
9. Honestidad: `insufficient = not literature or not citations`; `evidence_level = none si insufficient else banda` (0 citas ⟺ insuficiente).
10. `alerts` de condición (+ panel IA).
11. Escrituras: `log_retrieval` → `_insert_note` (INSERT dinámico: `alerts` y `evidence_level` solo si la columna existe — sondeo cacheado con TTL 300 s para False, True para siempre) → `log_answer` (con `note_id` y modelo real). No transaccional entre sí.

### 9.2 Front (grabar → transcribir → nota → aprobar)

```
"Nueva consulta" → insert consultations → /dashboard/consultas/{id}?grabar=1
  → consentimiento Ley 1581 (BLOQUEANTE: fila en consents; un trigger en DB lo exige)
  → consultaViva.iniciar()  [singleton src/lib/consulta-viva/sesion.ts]
       MediaRecorder webm/opus 48 kbps, trozos de 1 s
       cada trozo va AL MISMO TIEMPO al buffer local y al WS /athos/transcribe/live
       aviso a 45 min, corte duro a 90 min
  → detener(): cierra grabador → sube blob al bucket consultation-audios
       ({clinic}/{consulta}/{audio}.webm) → fila consultation_audios
       → live.finalizar(audio_id) persiste el transcript;
         si el vivo falló → athosTranscribe() (lote) como red de seguridad
  → botón "Generar sugerencia" → POST /athos/phantom/suggest
       → el back inserta clinical_notes (draft) → el front pone consultations.status='review'
  → el vet edita el SOAP → "Aprobar":
       gate de alergia = checkbox obligatorio (y trigger 0054 en DB)
       clinical_notes.status='approved' (+approved_by/at, allergy_acknowledged_at)
       consultations.status='completed'
```

- Estados de `consultations`: `open → transcribing → generating_note → review → completed` (los dos primeros los pone el backend; `review`/`completed` el front).
- La banda de evidencia que muestra el front sale de `clinical_notes.evidence_level` (migración 0025), **nunca de contar citas** (defecto histórico corregido en `8656e7a`).
- Las `SourceCard` de la nota solo se muestran con la nota aprobada (en borrador las citas aún pueden caer por fidelidad).
- Audio: retención **4 días** (`retain_until`, migración 0019) y purga por cron de Vercel (03:00 UTC) — sin `CRON_SECRET` la purga no corre y se incumple la Ley 1581 **en silencio**.

---

## 10. Transcripción

### Por lotes (`transcription.py`)
`POST /athos/transcribe`: baja el último audio del bucket privado `consultation-audios` (con `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — **deben apuntar al mismo proyecto donde el front sube**, hoy el principal) → `POST api.deepgram.com/v1/listen` con `model=nova-2, language=es, diarize=true, punctuate=true, smart_format=true` (Content-Type `audio/webm` fijo) → `build_segments` agrupa palabras por hablante → roles → inserta `transcripts` (`stt_provider='deepgram'`) y deja la consulta en `generating_note` (o la devuelve a `open` si falla).

### En vivo (`streaming_transcription.py`)
WS propio ↔ `wss://api.deepgram.com/v1/listen` con `interim_results=true` y **sin `encoding`/`sample_rate`** (webm/opus contenerizado; fijarlos rompe la transcripción). KeepAlive cada 5 s. `DeepgramLiveSession` acumula finales (descarta reenvíos por `start <= fin_confirmado`) y **reconstruye el payload del lote** para reusar `build_segments`/`render_full_text` (una sola implementación de diarización). Cierre en dos tiempos (el navegador sube el audio y recién entonces `finalize`, por la FK `transcripts.audio_id`). Cualquier fallo → `{type:"error", fallback:true}` y el front cae al camino por lotes.

### Roles de hablante (`speaker_roles.py`)
Determinístico: léxicos con pesos (titular: "doctor", "mi perro", "le doy…"; vet: "vamos a revisar", "compatible con", "hemograma"…), normalización sin acentos, puntúa el texto **completo** de cada hablante y exige margen `MIN_MARGEN=2.0`; sin confianza cae a `{0: Veterinario, 1: Titular}` con `role_inferred=false`. Existía porque asumir "el vet abre la consulta" invertía diálogos enteros (el dueño suele abrir). Backfill disponible: `scripts/calidad/transcripts_reetiquetar.py` (dry-run por defecto).

---

## 11. Contexto y memoria de paciente

- **`patient_context.py`** — 3 queries con `clinic_id` explícito: `patients` (especie, peso, `birth_date`→edad), `allergies` (`severity='severe'`), `medications`. Paciente de otra clínica → contexto vacío (aislamiento silencioso).
- **`patient_memory.py`** — memoria semántica por paciente en `patient_embeddings` (mismo modelo/dimensión que el corpus: cambiarlo obliga a re-embeddizar TODO):
  - **Indexa** notas `approved`/`locked` (NUNCA `draft`: realimentaría el error del modelo) + transcripts, idempotente por `(clinic_id, source_id, source_type)`, en un hilo daemon disparado desde el chat (el backend no tiene evento de "nota aprobada"; cada consulta deja lista la memoria para la siguiente).
  - **Recuerda** (`recall`): top-5 por coseno filtrando `clinic_id AND patient_id`, reutilizando el vector que el Tier 2 ya cacheó (cero llamadas extra a Cohere). Va al prompt en sección propia marcada "NO es literatura, no la cites".
  - El **Fantasma no la usa** (hueco conocido, ver §18).

---

## 12. El agente de Next

Vive en `src/lib/athos-agent/` + `src/app/api/athos/`. Contrato del producto: **"Athos propone — el vet ejecuta"**, impuesto por el esquema, no por el prompt.

### 12.1 Ruta principal `/api/athos/agent`

`streamText` del AI SDK con `stopWhen: stepCountIs(8)`, `maxOutputTokens: 2000`. Pipeline de la request: sesión (401) → `rateLimit` 30 req/min/usuario (429; en memoria por lambda) → clínica activa (403) → **presupuesto** (402) → contexto (clínica, señales, pantalla) → modelo por env → tools → stream. `onFinish` persiste solo el turno nuevo en `athos_messages`; `onError` traduce `clasificarFallo` (saldo/credencial/límite/servicio/red) a español sin filtrar el error crudo.

### 12.2 Las 22 tools (`tools.ts`)

- **13 de lectura** (corren con la sesión del vet, RLS real): `search_patients`, `get_patient_summary`, `get_owner_by_phone`, `search_consultations`, `get_consultation_details`, `list_appointments_on_day`, `get_clinic_hours`, `list_available_slots`, `search_whatsapp_conversation`, `search_emails`, `read_email_thread`, `search_clinical_evidence` (→ `/athos/retrieve`, cuelga su "no hay evidencia" de `evidence_level`), y el contexto de pantalla.
- **9 de escritura** (→ fila `proposed` en `athos_actions` vía `proposeAction()` con service_role): `send_whatsapp_message`, `send_email`, `reply_email`, `create_appointment`, `update_appointment`, `create_owner`, `create_patient`, `create_owner_and_patient`, `update_patient_record`.

### 12.3 Ciclo de aprobación (`athos_actions`)

```
tool de escritura → proposeAction() → fila status='proposed', risk='approval' (fijo)
  → tarjeta ActionApprovalCard (el vet puede EDITAR campos: body, subject, to_email)
  → POST /api/athos/actions/[id]/execute  (o /reject)
       1. lee con la SESIÓN del vet (RLS) → 404 si no es su clínica
       2. status≠proposed → 409 · vencida (7 días) → 410
       3. validarPayload (Zod) re-valida y DESCARTA campos desconocidos → 400
       4. reserva atómica: UPDATE … WHERE status='proposed' (doble clic → 409)
       5. dispatch con la sesión del vet (las RPC SECURITY DEFINER ven auth.uid() real)
       6. markAction(executed|failed) + audit_logs
```

RLS de la tabla: **solo SELECT** por clínica; INSERT/UPDATE sin policy (solo service_role desde rutas de Next). En la bandeja de WhatsApp, "Enviar" el borrador **es** aprobar la acción (`payload_override: {body}`). `PendingActions` relee las `proposed` de la tabla para que sobrevivan a recargas.

### 12.4 Modelos, cascada y presupuesto

- `model.ts`: `agentModel()` / `autoModel()` / `visionModel()` según `ATHOS_AGENT_PROVIDER`/`ATHOS_AGENT_MODEL` (+ variantes AUTO/VISION); `ATHOS_*_CASCADE` (`modelo@proveedor,…`) manda sobre el par. Proveedores: `anthropic`, `deepseek`, `google` (⚠️ se llama `google`, no `gemini`; `@ai-sdk/google` está fijado a `~3.0.103` porque la 4.x rompe la cascada en silencio).
- La cascada quedó **probada en producción**: hasta el 31-jul respondía Claude; el 2-ago Anthropic se quedó sin crédito y pasó a DeepSeek sin intervención (traza en `athos_actions.proposed_by_model`).
- **Presupuesto** (`presupuesto.ts` + tabla `athos_agent_usage`): `ATHOS_TOPE_MENSUAL_POR_CLINICA` — vacía = **1000** llamadas/mes por clínica (tope de contención), `"ninguno"` = sin tope, `0` = kill-switch. Falla **abierta**. Cada llamada registra `surface, provider, model, fell_back_from, tokens_in/out` (`usage.ts`; nunca lanza). Medidor visible: `CupoDeIA` en el riel. **Decisión de negocio abierta:** al corte del 16-ago la variable NO está en Vercel Production → el tope no corta nada; encenderlo es ponerla (sin redespliegue de código, pero las env vars solo toman efecto al redeployar).
- **Contexto de pantalla** (`athos-context/`): el front deriva de la ruta qué pantalla mira el vet (paciente/consulta/agenda/…) y lo pasa al system prompt — validado con Zod; falsearlo solo hace que el modelo "mire otra pantalla" porque toda lectura pasa por RLS. El commit `21d6eb5` cerró la falsificación de la marca de control (`MARCA_PROPUESTA`), y `d56a216` le dio conciencia de la sala de espera sin gastar tokens.

### 12.5 Modo auto de WhatsApp

Opt-in por clínica (`whatsapp_integrations.agent_mode='auto'`, solo admin). Salvaguardas: debounce 5 s, reserva atómica del entrante (0038), máx. 8 respuestas/hora/conversación, límite diario con warm-up (5·(1+días conectados)), `auto_daily_limit`. El `agent_mode` es el único interruptor de **permiso**; el resto son frenos de volumen.

---

## 13. El frontend de Athos

Piezas clave (todas bajo ownership Plogy):

- **Clientes**: `src/lib/athos.ts` (SSE del chat clínico parseado a mano, `athosPhantomSuggest`, `athosTranscribe`; errores saneados con `sinNombresDeProveedor`), `src/lib/athos-live.ts` (WS de transcripción, nunca lanza — marca `fallback`), `src/lib/athos-history.ts` (precarga del historial).
- **Grabación**: `src/lib/consulta-viva/` — singleton fuera de React (`sesion.ts`), puente `useSyncExternalStore` (`usar.ts`), cuaderno con autosave debounce 1200 ms (`cuaderno.ts`). Fases: `inactiva|grabando|subiendo|transcribiendo|terminada|perdida`. Tres superficies observan el mismo singleton (pastilla global, panel, bloque de la consulta) — unificadas en la migración 0058/commits `bb8a1d4`..`aae70ef`.
- **Componentes** (`src/components/athos/`): `athos-provider` (contexto de pantalla), `athos-dock` (pastilla+burbuja+panel), `athos-widget`, `athos-mensajes` (render compartido del hilo), `action-approval-card`, `pending-actions`, `consultation-thread` (único consumidor del SSE clínico), `panel-modo-fantasma`, `grabacion-pastilla`, `cuaderno`, `rich-text` (citas `[n]` enlazadas), `source-card`, `riel-clinica` (+`CupoDeIA`), `connect-email-card`.
- **Páginas**: `/dashboard/asistente` (pantalla de inicio), `/dashboard/consultas` (listado "Modo Fantasma"), `/dashboard/consultas/[id]` (la pantalla clave: nota + hilo + grabador), `/admin/uso` y `/admin/costos` (consumo de IA).
- **Render clínico**: `renderPlan` cruza `allergies` con el texto y marca alérgenos en rojo/ámbar (determinístico); banda de evidencia desde `evidence_level`; `ai_model` no se manda al front a propósito (solo `/admin`).
- **Supabase en el front**: 4 clientes — `server.ts`/`client.ts` (sesión del vet, RLS aplica), `middleware.ts` (refresh de cookies vía `src/proxy.ts`), `admin.ts` (**service_role**, solo donde la RLS no puede expresar la operación: propuestas del agente, webhooks; siempre con `clinic_id` explícito).
- **Tests**: vitest `environment: node`, solo `src/**/*.test.ts` → la lógica importante vive en `.ts` (no en componentes). No hay E2E (deuda declarada).

---

## 14. Modelo de datos y migraciones

### 14.1 Global vs por clínica

| Ámbito | Tablas |
|---|---|
| **GLOBAL** (sin `clinic_id`) | `corpus_chunks`, `glossary_term`, `glossary_synonym`, `glossary_relation` |
| **POR CLÍNICA** (`clinic_id` + RLS con `private.my_clinic_id()`) | `patients`, `owners`, `allergies`, `medications`, `consultations`, `consents`, `consultation_audios`, `transcripts`, `clinical_notes`, `patient_embeddings`, `athos_messages`, `rag_retrieval_log`, `rag_answer_log`, `athos_actions`, `athos_agent_usage`, `whatsapp_*`, … |

`private.my_clinic_id()` = `select clinic_id from profiles where id = auth.uid()` (SECURITY DEFINER). Desde 0022, `memberships` es la fuente de pertenencia y `profiles.clinic_id` el puntero de "clínica activa".

### 14.2 Tablas nucleares de Athos

- **`corpus_chunks`**: `id, source, title, content, embedding vector(1024), metadata jsonb, tsv, created_at`. Metadata: `especie, categoria, tier, mesh[], locator, ordinal, is_current, content_hash, embedding_model, url, titulo, year, doi, idioma…`. Índices: HNSW coseno (`0002`), GIN de `tsv` y de `metadata` (`0001`), **GIN de expresión `(metadata->'mesh')`** (`0003`). RLS default-deny + revoke (`0026`) — Athos la lee por psycopg privilegiado, no por PostgREST.
- **`patient_embeddings`**: por clínica, `vector(1024)`, HNSW (`0002`), índice `(clinic_id, patient_id)`.
- **`clinical_notes`**: enum `draft|approved|locked`, SOAP, `citations` (0001), `alerts` (0004), `evidence_level` con CHECK (0025), `allergy_gate_triggered`, `allergy_acknowledged_at` + **trigger `clinical_notes_guard`** (0054: nota aprobada inmutable, gate de alergia en la DB).
- **Trazas** (0001): `athos_messages` (hilo del chat; índice hot-path `(clinic_id, patient_id, created_at desc)` en 0020), `rag_retrieval_log` (⚠️ `query_raw/filters/tier_reached/scores` quedan NULL — nadie las escribe), `rag_answer_log` (solo la escribe el Fantasma; el chat no).
- **`athos_actions`** (0029, §12.3) y **`athos_agent_usage`** (0046; sin SELECT de clínica desde 0052).

### 14.3 Migraciones — reglas de vida o muerte

- `supabase/migrations/*.sql` = **única fuente de verdad** de los cambios propios. Flujo **dev → PR → principal** con `supabase db push` (mismos archivos). El bootstrap **no** se PR-ea.
- **64 archivos**, numeración con cicatrices (dos `0019`, dos `0020`, un `0021b`) por el drift histórico: la tanda del equipo entró renumerada como `0026`–`0036` y **ya está aplicada al principal** — no reaplicar.
- ⚠️ **El registro de migraciones del principal MIENTE** (56 filas vs 53 archivos; 10 aplicadas sin registrar; 13 filas sin archivo; 11 números que significan cosas distintas). Un `db push` ciego **re-aplicaría el índice HNSW (4 GB)**. La única verdad es la introspección del catálogo (`scripts/calidad/auditar_esquema.py`).
- Regla de merge dura: tabla por-clínica sin RLS + test cross-tenant **no se mergea**.
- Levantar dev desde cero: bootstrap + bucle de migraciones (`0021b` crea los objetos huérfanos que lo desbloquean) — runbook completo en `athos-service/docs/MIGRACIONES.md`, camino local con Docker + shim en `.github/ci/`.

---

## 15. Ingesta del corpus

- **Entrada**: 61.544 markdown con frontmatter YAML + `manifest.csv` (en inglés, validados por el proveedor). El corpus NO vive en el repo.
- **Ampliación 2026-08-19 (en curso)**: llegaron dos entregas nuevas (lote 3 + corpus_nuevo_2); por decisión aprobada se indexa **solo el núcleo clínico de mascotas** (`alcance=companion` y `qc_verdict!=reject`, ≈15.799 docs) al principal — producción/ganadería/equino y los `reject` quedan fuera porque el retrieval no filtra por `alcance` y ensuciarían las búsquedas. Método: el mismo pipeline sin modificar, idempotente por `content_hash` (re-correr el driver reanuda). Detalle: `athos-service/docs/INGESTA-CORPUS-2026-08-19.md`.
- **CLI**: `uv run python -m app.ingestion.run --manifest data/corpus/manifest.csv --token-budget N` (o `--path … --limit N`). Orden **proporcional por especie** (cualquier prefijo es representativo), lotes de 90 textos por llamada a Cohere, guard de presupuesto por `total_billed_tokens`, reanudable.
- **Pipeline por documento** (`pipeline.py`): frontmatter→metadata (BOM fuera, `yaml.safe_load`) → chunking `MAX_TOKENS=800` palabras con solape `OVERLAP=100`, **las tablas son bloques atómicos** (nunca se parten ni se duplican en el solape) y el `locator` es la sección del primer bloque → embedding Cohere (dim 1024, `input_type=search_document`) → INSERT con `tsv = to_tsvector(<regconfig del idioma>, content)` (EN→english, ES→spanish, desconocido→simple).
- **Idempotencia** por `content_hash` (del frontmatter, o SHA-256 truncado a 16 hex): precarga de hashes al arrancar; documento ya ingerido se salta sin gastar Cohere. Conexión dedicada con `statement_timeout=0` (los INSERT sobre HNSW se encarecen al crecer).
- **Costo de referencia**: ~US$0,12/M tokens Cohere; el corpus completo costó ~US$73.
- ⚠️ Huecos (ver §18): el paso "etiquetar con glosario" no existe (`tag_with_glossary` → NotImplementedError), no hay versionado `is_current=false`, no hay normalización de PDFs, y `upsert_chunks` es un INSERT sin ON CONFLICT.

---

## 16. Variables de entorno

### 16.1 Railway (athos-service) — leídas por `app/config.py` (pydantic-settings; el campo en MAYÚSCULAS es la env var; `get_settings()` está cacheado → **cambiar una variable exige reiniciar el servicio**)

| Variable | Default | Para qué |
|---|---|---|
| `DATABASE_URL` | — | DB de **paciente + trazas** (principal) |
| `CORPUS_DATABASE_URL` | vacía → cae a `DATABASE_URL` | DB del **corpus/glosario** |
| `SUPABASE_URL` | — | deriva el JWKS y baja audio de Storage (debe ser el MISMO proyecto donde el front sube el audio) |
| `SUPABASE_SERVICE_ROLE_KEY` | — | bearer para bajar audio del bucket privado |
| `SUPABASE_JWKS_URL` / `SUPABASE_JWT_SECRET` | — | verificación del JWT (ES256 / HS256 legacy) |
| `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_LIGHT_MODEL` / `LLM_API_KEY` | anthropic / — / claude-sonnet-5 / claude-haiku-4-5 / — | proveedor primario y modelos (prod: DeepSeek) |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `GEMINI_BASE_URL` | — | keys propias para la cascada (sin key propia, esa rama se filtra) |
| `LLM_CASCADE_REDACCION` / `LLM_CASCADE_LIVIANO` / `LLM_CASCADE_DIFICIL` / `LLM_CASCADE_MAX_INTENTOS` | vacías / 3 | cascada `modelo@proveedor,…` (vacía = un solo proveedor) |
| `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` / `EMBEDDING_DIM` / `EMBEDDING_API_KEY` | cohere / embed-v4.0 / **1024** / — | embeddings (la dimensión DEBE coincidir con `vector(1024)`) |
| `RERANK_ENABLED` / `RERANK_MODEL` / `RERANK_API_KEY` | true / rerank-v3.5 / vacía → reusa la de embeddings | reranker |
| `JUDGE_ENABLED` / `JUDGE_MODEL` / `JUDGE_ABSTAIN_MAX` / `JUDGE_LIMITED_MAX` / `JUDGE_PASSAGES` / `JUDGE_CHAT_TIMEOUT_S` | true / vacía→liviano / 2 / 6 / 6 / 4.0 | juez de evidencia (⚠️ apuntarlo al modelo grande se probó y REVIRTIÓ: sobre-abstención ×2,5) |
| `FIDELITY_ENABLED` / `TRANSCRIPT_FIDELITY_ENABLED` / `NOTE_FIDELITY_MODEL` | true / true / deepseek-v4-pro | auditores (interruptores de rollback) |
| `DEEPGRAM_API_KEY` / `STT_MODEL` | — / nova-2 | transcripción |
| `CORS_ORIGINS` | localhost:3000 | orígenes del front, separados por coma |
| `SUPABASE_ANON_KEY` / `APP_ENV` | — | ⚠️ **declaradas pero NUNCA leídas** (settings muertas: cambiarlas no hace nada) |

⚠️ `.env.example` está desactualizado: faltan `CORPUS_DATABASE_URL`, `ANTHROPIC_API_KEY`, `LLM_CASCADE_DIFICIL`, `RERANK_*`, `JUDGE_*`, `FIDELITY_ENABLED`, `TRANSCRIPT_FIDELITY_ENABLED`, `NOTE_FIDELITY_MODEL`, `SUPABASE_JWKS_URL`.

### 16.2 Vercel (front + agente)

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase del navegador (obligatorias) |
| `SUPABASE_SERVICE_ROLE_KEY` | `createAdminClient()` — propuestas del agente, claims, audit, usage, crons, webhooks |
| `NEXT_PUBLIC_ATHOS_URL` | base del backend en Railway (chat SSE, phantom, transcripción, `/athos/retrieve`). **Igual en production y preview** |
| `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / `GEMINI_API_KEY` (+`*_BASE_URL`) | proveedores del agente (la de Anthropic la lee el SDK directo del entorno) |
| `ATHOS_AGENT_PROVIDER` / `ATHOS_AGENT_MODEL` / `ATHOS_AGENT_CASCADE` | modelo del agente (la cascada manda) |
| `ATHOS_AUTO_*` / `ATHOS_VISION_*` | modo auto de WhatsApp / lectura de recetas-facturas por foto |
| `ATHOS_TOPE_MENSUAL_POR_CLINICA` | tope de gasto (vacía=1000, `ninguno`, `0`=kill-switch). **Hoy NO está puesta en Production** |
| `CRON_SECRET` | crons (purga de audio ⚠️ Ley 1581, cartera) y `/api/health`. También en GitHub Actions |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` | enlaces absolutos / webhooks (definirla EN BLANCO rompe el fallback) |
| WhatsApp: `NEXT_PUBLIC_WA_PROVIDER`, `META_*`, `EVOLUTION_BASE_URL/API_KEY/WEBHOOK_TOKEN`, `KAPSO_*`, `WHATSAPP_TOKEN_KEY` | capa proveedor-agnóstica (`evolution`/meta/kapso). ⚠️ el nombre correcto es `EVOLUTION_BASE_URL` (no `EVOLUTION_API_URL`) |
| Correo: `COMPOSIO_API_KEY` + `COMPOSIO_*_AUTH_CONFIG_ID`, `RESEND_API_KEY`, `TRANSACTIONAL_FROM_EMAIL` | correo de Athos por miembro / transaccional |
| `PLATFORM_ADMIN_EMAILS` | allowlist de `/admin` |

---

## 17. Operación

### Desplegar
Merge a `master` → Vercel (front) y Railway (backend, solo si cambió `athos-service/**`) despliegan solos. Verificación mínima: `GET /health` del backend, `GET /api/health` del front (chequea athos_url, keys, cascada con credenciales, CRON_SECRET…), y un chat con citas en producción. **Athos frío tarda ~20 s** (el front puede abortar): calentar antes de una demo.

### Medir calidad (metodología, aprendida a golpes)
- **Bancos**: `tests/golden/cases.json` (11, saturado — solo humo), `ampliado.json` (146 casos **anclados al corpus**: la verdad es si el `mesh` del chunk contiene el target, no una opinión), `ampliado_negativos_validado.json` (18 negativos buenos), `ampliado_v2.json` (153).
- **Scripts** (`scripts/calidad/`, READ-ONLY salvo glosario): `golden_eval.py` (hit@15/precision@15 — correr antes/después de tocar la cascada), `recall_ciego.py` (¿en qué paso se pierde el target?), `respuestas_eval.py`/`respuestas_ab.py` (chat), `phantom_eval.py`/`phantom_ab.py` (nota), `abstencion_*.py` (juez), `fidelidad_calibrar.py`, `latencia_db.py`/`latencia_e2e.py`, `auditar_esquema.py` (producción vs repo).
- **Reglas de método**: el juez LLM absoluto tiene ruido ±1 punto / ±20 pp entre corridas idénticas; el pareado tiene 78% de sesgo de posición → **si la mejora se puede contar determinísticamente, contala**; cambios chicos exigen A/B pareado; **medir siempre contra producción** (medir contra dev con 67k chunks desmintió un "recall ciego" que era artefacto); los scripts **importan** el prompt/SQL de producción, nunca lo copian.
- Cifras de referencia en producción (2026-07-28): hit@15 83,6%, precision@15 30,5%, rank mediano del primer acierto 2.

### Costos por uso
Deepgram $0,0043/min · LLM $0,004–$0,024 por llamada · Cohere embed+rerank ~$0,0026 por búsqueda · WhatsApp por conversación · Resend por envío. Infra fija: ~$25/mes Supabase. El Fantasma es el módulo más caro (consulta de 20 min ≈ $0,09 solo de transcripción).

### Rollbacks sin tocar código
`FIDELITY_ENABLED=false`, `TRANSCRIPT_FIDELITY_ENABLED=false`, `JUDGE_ENABLED=false`, `RERANK_ENABLED=false`, vaciar cualquier `LLM_CASCADE_*`, `ATHOS_TOPE_MENSUAL_POR_CLINICA=0` (kill-switch del agente). Todos exigen **reiniciar/redeployar** el servicio correspondiente (settings cacheadas).

---

## 18. Deuda técnica y huecos conocidos

Consolidado verificado en código al 2026-08-21. Nada de esto es especulación.

**Ingesta / corpus**
1. `tag_with_glossary` → `NotImplementedError` y nadie la llama: `metadata.glossary_terms` **nunca se puebla** (el Tier 1 vive del `mesh` del frontmatter + full-text, pese a lo que dicen CLAUDE.md y el doc de diseño).
2. Sin versionado: un documento re-entregado con hash distinto entra **duplicado** y ambos quedan `is_current=true`.
3. Sin normalización de PDFs/otros idiomas; solo `.md` UTF-8. `upsert_chunks` es INSERT sin ON CONFLICT.
4. No hay herramienta de re-embedding (cambiar de modelo de embeddings = re-ingerir todo).

**Retrieval / generación**
5. `passed` saturado (True 187/187): la abstención real es el juez — todo consumidor debe leer `evidence_level`.
6. El rerank degrada **en silencio** (sin log): si la key falla, la calidad cae sin alarma.
7. `fuse_context()` y `retrieve()` no se usan en producción (solo tests/scripts); `generate_chat_answer` es un stub muerto; `WEAK_MIN_RESULTS`/`_is_weak` son código muerto documentado.
8. `glossary_relation` creada y jamás tocada; `seed_from_decs()` sin implementar; `StructuredQuery.language` es `"en"` fijo (las regconfig es/pt son inalcanzables).
9. `dose_guard` solo cubre dosis por peso ("500 mg cada 12 h" pasa; `undeclared` lo informa pero no lo tapa).
10. El auditor de nota atrapa 3 de 9 notas con invento (recall pobre a propósito de la precisión): es red parcial, **no** "nota auditada".
11. `verify_citations` compara `chunk_id` case-sensitive (el rescate inline normaliza a minúsculas) — candidato a unificar.

**Trazabilidad**
12. `rag_answer_log` solo lo escribe el Fantasma; el chat no deja fila ahí y `message_id` nunca se llena.
13. `rag_retrieval_log.query_raw/filters/tier_reached/scores` siempre NULL — no se puede reconstruir qué tier aportó cada chunk.
14. Las consultas generales del chat (sin paciente) no dejan traza (decisión consciente; tráfico invisible para analítica).
15. En el Fantasma, `log_retrieval` corre **después** de generar: un 502 por nota vacía no deja traza del retrieval.

**Backend / config**
16. `SUPABASE_ANON_KEY` y `APP_ENV` son settings muertas; `.env.example` desalineado (~9 variables reales faltan).
17. `get_settings()` cacheado: ningún cambio de env var aplica sin reiniciar.
18. Endpoints síncronos (`def`) + un solo worker uvicorn: la concurrencia real es el threadpool de Starlette.
19. `/athos/transcribe` no expone `segments` (el servicio los produce); `_call_deepgram` fija `Content-Type: audio/webm` aunque el audio diga otra cosa.
20. El sondeo de columnas de `clinical_notes` cachea `True` para siempre: revertir 0004/0025 en caliente rompe el insert hasta reiniciar.
21. `whatsapp_reply.py` + `/athos/whatsapp/suggest` + `athosWhatsappSuggest` están **huérfanos** (la bandeja usa el agente de Next): borrar o documentar.

**Front**
22. Sin timeout/abort en `athosPhantomSuggest`, `athosTranscribe` y el SSE de `ConsultationThread`; `athosChat` no sanea el mensaje de error.
23. El front no muestra `unsupported_claims` (viajan en el payload del Fantasma pero no hay UI).
24. `role_inferred=false` viaja por segmento pero no hay UI de intercambio de roles (y la etiqueta va embebida en `full_text`).
25. Aprobación de nota = dos updates sin transacción (`clinical_notes` + `consultations`).
26. `athos_messages.patient_id` sin FK → PostgREST no puede hacer embed (join manual en el sidebar).
27. `rateLimit` en memoria por lambda; el freno real de gasto es el presupuesto (falla abierta) — y el tope hoy está **apagado en producción**.

**Datos / entorno**
28. El registro de migraciones del principal miente en las dos direcciones; `db push` ciego re-aplicaría el HNSW (4 GB). Introspección o `auditar_esquema.py`.
29. La suite del front no corre en máquinas con Node < 22.12 (vite); la suite del back necesita una base dev viva.
30. FUNCIONALIDADES.md dice 21 tools y 7 días de retención; el código dice **22 tools** y **4 días**.

---

## 19. Índice de documentación existente

| Documento | Qué contiene |
|---|---|
| `skeleton/athos-service/CLAUDE.md` | Reglas del servicio, cascada, contrato (la referencia diaria) |
| `skeleton/athos-service/docs/tuvetia_rag_documento_final.md` | Diseño original del RAG (§7 esquema, §9 ingesta, §11 cascada) — con las divergencias señaladas en §18 |
| `skeleton/athos-service/docs/ATHOS_CONTEXTO_EQUIPO.md` | Contexto para el equipo + bitácora histórica completa |
| `skeleton/athos-service/docs/MIGRACIONES.md` | Runbook de entornos y migraciones (léelo antes de tocar el esquema) |
| `skeleton/athos-service/scripts/calidad/README.md` | El banco de calidad: qué mide cada script y cómo |
| `skeleton/docs/ARQUITECTURA.md` | Arquitectura del front (las 4 decisiones que explican todo) |
| `skeleton/docs/CONFIGURACION-PRODUCCION.md` | Los tres almacenes de variables y sus trampas |
| `skeleton/docs/ENTORNOS-QUE-APUNTA-A-DONDE.md` | El mapa de entornos y el incidente que lo originó |
| `skeleton/FUNCIONALIDADES.md` | Inventario comercial (⚠️ 2 cifras desactualizadas, ver §18.30) |
| `skeleton/docs/entrega/CAPA-AGENTICA-ESTADO.md` | El agente explicado para no-técnicos, con verificación en 5 min |
| `skeleton/docs/entrega/DOSSIER-EVIDENCIAS-MILESTONE2.md` | Dossier de evidencias del Milestone 2 |
| `skeleton/docs/entrega/ATHOS-DOCUMENTACION.html` | **La versión didáctica de este documento** |

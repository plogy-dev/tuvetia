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
- **Ubicación (monorepo):** repo **`plogy-dev/tuvetia`** — front Next en la **raíz** + este backend en **`athos-service/`**. Athos despliega en **Railway** (*Root Directory* = `athos-service/`); DB en **Supabase**; front en **Vercel**; Phantom lo hace Pipe.

## 9. Dónde está el detalle
- Diseño completo del RAG: `tuvetia_rag_documento_final.md` (misma carpeta)
- Reglas para Claude Code: `../CLAUDE.md`
- Montaje del microservicio paso a paso: `../SETUP.md`
- Entornos y migraciones (dev → PR → principal): `MIGRACIONES.md`

## 10. Bitácora de montaje y decisiones (se actualiza)
> Registro vivo del progreso del microservicio, para que Santiago y Pipe sigan el avance y las decisiones. Última actualización: **2026-07-16**.

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

**2026-07-14 — Migración `0002` (HNSW) verificada en dev + coordinación abierta para el PR a main**
- Migración **`0002` aplicada y verificada en dev**: índice vectorial **HNSW** en `corpus_chunks` y `patient_embeddings` (reemplaza el ivfflat del base, mismos nombres de índice).
- Consolidados los **3 puntos que necesitan decisión del equipo** antes de abrir el PR a main (tocan tablas generales y auth compartida) → ver **§11**. Nada tocado en el principal; todo probado en `tuvetia-athos-dev`.

**2026-07-14 — Motor RAG implementado (pasos 0–8) y validado en dev; ingesta de prueba OK**
- **Núcleo determinístico (sin IA), en verde en CI:** verificación de citas (descarta fuentes no recuperadas); cascada (Tier 0 especie como **preferencia por MeSH**, umbral/abstención, fusión en memoria por zonas); ingesta **parse + chunk** (locator, sin partir tablas/dosis); **gate de alergia severa**; **glosario ES→EN** (`resolve_concepts` + siembra desde MeSH del corpus + curación coloquial); **Tier 1 léxico** (full-text + MeSH) y **Tier 2 vector** (pgvector); **contexto de paciente** por clínica; **tests cross-tenant** (aislamiento por `clinic_id`, service_role).
- **Embeddings Cohere embed-v4 (dim 1024)** cableados. **Ingesta de prueba** (trial key) cargó **843 docs / 6.704 chunks** a `corpus_chunks` en dev (embedding + `tsvector` + metadata), **idempotente por `content_hash`**; paró exactamente en el límite mensual de la trial (validando el corte). La ingesta **completa** se corre al pagar Cohere.
- **Generación B→A (Anthropic):** armado de prompt + parseo/verificación de citas listos y testeados con el **LLM mockeado**.
- **Estado:** **28 tests** en verde, `ruff` limpio. **Pendiente (necesita API keys):** ingesta completa (Cohere pagada), **llamada real al LLM** de redacción, y **wiring de endpoints** `/athos/chat` y `/athos/phantom/suggest`.

**2026-07-15 — Producción: keys activas, corpus balanceado (14,6%) e ingesta afinada**
- **APIs de producción activas y validadas EN VIVO:** Anthropic (redacción B→A — generó una nota real y **se abstuvo correctamente** cuando la evidencia no calzaba) y Cohere embed-v4 (dim 1024). Keys solo en `.env` (a **rotar**: se pegaron en el chat).
- **Corpus en dev: 8.960 documentos / ~67.000 chunks**, **balanceado en las 8 especies** (perro, gato, mixto, ave, conejo, reptil, roedor, hurón) = **14,6% del corpus**. Ingesta con **orden proporcional por especie** (desde `manifest.csv`) + **guard de presupuesto por tokens facturados** + idempotencia por `content_hash` (reanudable).
- **Incidente resuelto:** al crecer `corpus_chunks`, los INSERT sobre el índice **HNSW** se vuelven lentos y superaron el `statement_timeout` de Supabase (crash de la corrida completa a ~62M tokens). Fix: `statement_timeout=0` por conexión + reconexión + skip barato al reanudar. **Datos intactos** (commit por lote).
- **Hallazgo (rendimiento):** para la ingesta del **corpus completo**, usar **drop-index HNSW → carga masiva → reconstruir índice** (evita el costo por-fila, mucho más rápido). Además, la **query del Tier 1 a escala** necesita `statement_timeout` alto / tuning de índices → **pendiente de optimizar**.
- **Presupuesto (rate de Cohere confirmado ≈ US$0,12/1M tokens):** corpus completo ~US$73 (~297.000 COP); **gastado US$8,02** (14,6%); **para completarlo hay que recargar ≈ US$57 ≈ ~230.000 COP** además del saldo actual. Palanca de ahorro: el 63% del corpus es especie **"mixto"** (38.539 docs) → priorizar categorías clínicas reduce bastante el costo.
- **Pendiente:** endpoints `/athos/chat` (SSE) y `/athos/phantom/suggest`; tuning de rendimiento del Tier 1; ingesta del corpus completo al aprobar presupuesto.

**2026-07-15 (tarde) — Fase 1 completa + convergencia al principal (incidente resuelto) + arquitectura de dos DBs**
- **Endpoints listos y validados EN VIVO:** `/athos/phantom/suggest` (nota SOAP + gate de alergia + citas) y `/athos/chat` (SSE, streaming, gate, citas). **Auth por JWKS ES256** del principal + fallback HS256 → cierra el punto C. (El principal firma los JWT con **ES256**.)
- **Front iniciado** en el repo del esqueleto (`plogy-dev/tuvetia`): `src/lib/athos.ts` (cliente SSE + phantom) + `src/app/dashboard/asistente/page.tsx` (chat). Aún sin pushear (para revisión de Santi).
- **Migración `0001` aplicada al principal** (glosario, `rag_*`, `corpus_chunks → vector(1024)`, tsv, RLS, `clinical_notes.citations`). **Puntos A/B resueltos:** las tablas vector estaban vacías → aplicó limpio.
- **⚠️ Incidente resuelto:** al copiar el corpus al principal se llenó el disco (free tier 500 MB → 868 MB) y Supabase lo puso **read-only**, afectando la app de Santi. **Recuperado:** `SET default_transaction_read_only=off` (por sesión) + `TRUNCATE corpus_chunks` → **13 MB, escritura restaurada.** La DB del principal volvió a la normalidad.
- **Arquitectura de dos DBs (config-driven, default = UNA sola):** el corpus completo (~7 GB) no cabe en el free tier del principal. `corpus_database_url` permite ubicar el corpus aparte (hoy: dev) SIN forzarlo. **Meta acordada: al pasar el principal a plan de pago → todo en una sola DB** (dejar `corpus_database_url` vacía + ingerir el corpus completo ahí). El corpus es global/aditivo, no cruza (JOIN) con datos de paciente → **sin conflicto** con el multi-tenant/RLS.
- **Estado:** corpus (67k chunks) en dev; principal con esquema RAG + datos reales de Santi; **28 tests verdes**. **Pendiente:** upgrade del principal a pago + ingesta completa ahí; deploy en Vercel (funciones Python en el repo del front); página de nota en el front; tuning Tier 1.
- **🔐 Seguridad:** rotar la **password de DB del principal** y la **`sb_secret`** (se pegaron por chat).

**2026-07-16 — Demo end-to-end en local, fixes de calidad/rendimiento, rediseño del front y monorepo**
- **Corrida end-to-end EN LOCAL (prod-like) validada:** front (Next en `localhost:3000`) + Athos (`localhost:8000`) contra el **principal** (paciente + trazas) y el **corpus en dev** (67k chunks), con auth por **JWKS ES256** del principal. (En local, `localhost:3000` **no** está en la allowlist de *Redirect URLs* del principal → el magic-link normal no vuelve a localhost; se entró generando un magic-link con la `service_role` del principal. Para el login normal en local habría que agregar `http://localhost:3000/**` a esa allowlist.)
- **Fix de calidad (nota SOAP vacía):** la generación se truncaba a `max_tokens=2000` (`stop_reason=max_tokens`) → JSON incompleto → nota con los 4 campos vacíos. Subido a **4000** → cierra el JSON, nota completa y citada. (`fix(generation)`.)
- **Fix de rendimiento (Tier 1):** hacía **Seq Scan** de los 67k chunks (el `OR metadata->'mesh' ?| …` no era indexable) → ~**44 s**. **Índice GIN de expresión** sobre `metadata->'mesh'` (**migración `0003`**) → *BitmapOr* → ~**2 s** (~20×). Verificado con `EXPLAIN ANALYZE`. El índice ya está en dev; la `0003` es la fuente de verdad para aplicarlo al principal en la convergencia.
- **Rediseño del front (Copiloto + Modo Fantasma):** se tomó el **layout/UX de la propuesta original** (`docs/tuvetia_presentacion.html`) — chat por bloques con “fuente verificable”; Fantasma con **transcripción + nota SOAP en borrador lado a lado**, gate de alergia y citas — con el **tema neutro del proyecto** (sin marca ni paleta ajena). **Demo grabada.**
- **Monorepo (DECIDIDO):** el backend Athos entra al repo **`plogy-dev/tuvetia`** bajo **`athos-service/`** (vía `git subtree`, **historial preservado**); el front sigue en la raíz. **Vercel** sin cambios; **Railway** apunta su *Root Directory* a `athos-service/`. Dos PRs abiertos: **#1** (UI del front) y **#2** (backend en el monorepo). Verificado que **ningún `.env`/`.env.principal`** entró a git (solo `.env.example`).
- **Datos de demo en el principal** (reversibles con `cleanup_phantom.sql`): 5 consultas + transcripts + 1 alergia severa + `devsplogy` agregado a la clínica de prueba de Santi.
- **Pendiente:** mergear PR #1/#2; **rotar credenciales** (password DB principal, `sb_secret`, keys Anthropic/Cohere); post-merge trabajar el backend **desde el monorepo**; iterar estética y formatos de respuesta del chat.

## 11. Coordinación abierta — 3 decisiones que necesitamos del equipo (antes del PR a main)
> Todo lo de abajo está **probado en el proyecto dev** (`tuvetia-athos-dev`, ref `ghmpjyuchwkrvnjvdeum`). **Nada se ha tocado en el principal** (ref `auxlnexhkmtoedrzfsnz`). Para llevar las migraciones `0001`/`0002` al principal necesitamos confirmar 3 cosas, porque tocan **tablas generales** y **auth compartida**. El PR incluirá **solo** `supabase/migrations/0001*.sql` y `0002*.sql` (el bootstrap **no** se PR-ea).

### A) Dimensión de embeddings: `1536` → `1024`  ·  ✅ DECIDIDO (2026-07-14)
> **Decisión (nuestra recomendación):** el principal se estandariza en **1024**. La migración `0001` ya lo implementa. Único paso operativo al aplicar el PR: confirmar si `corpus_chunks`/`patient_embeddings` del principal ya tienen datos (para planear re-embed si los hubiera).
- **Qué pasa:** el esquema base declara `corpus_chunks.embedding` y `patient_embeddings.embedding` como `vector(1536)`. La decisión cerrada de Athos es **1024** (Cohere embed-v4, cross-lingual ES→EN). La `0001` ya hace `alter … type vector(1024)` (aplicado en dev).
- **Por qué importa:** si en el principal esas columnas **ya tienen vectores** (1536), no se pueden castear a 1024 → hay que **re-embeddear**. Además corpus y `patient_embeddings` deben usar el **mismo** modelo/dimensión.
- **Nuestra recomendación:** estandarizar el principal en **1024**. El corpus (61.544 docs) aún no está ingerido; si esas dos tablas están **vacías** en el principal, el cambio es gratis (solo el `ALTER`).
- **Necesitamos de ustedes:** (1) confirmar que en el principal `corpus_chunks` y `patient_embeddings` **están vacías** (sin vectores de producción); (2) OK a fijar la dimensión en **1024**; (3) si ya hubiera datos, acordar el re-embed.

### B) Índice vectorial: ivfflat (base) → **HNSW** (`0002`)  ·  ✅ DECIDIDO (2026-07-14)
> **Decisión (nuestra recomendación):** se adopta **HNSW** (`m=16`, `ef_construction=64`). Ya en la migración `0002`, verificada en dev. Único paso operativo: si las tablas del principal tienen datos, agendar el rebuild del índice en ventana de bajo tráfico.
- **Qué pasa:** el base crea índices **ivfflat** (`corpus_chunks_embedding_idx`, `patient_embeddings_embedding_idx`). La `0002` los reemplaza por **HNSW** (mejor recall/latencia, robusto al crecer, sin tunear `lists`). Ya **aplicada y verificada en dev**.
- **Por qué importa:** son **tablas generales**; si tienen datos en el principal, crear el índice HNSW es un **rebuild** (construcción más costosa, una sola vez → conviene ventana de bajo tráfico). Requiere **pgvector ≥ 0.5.0** (Supabase lo trae; confirmado funcionando en dev).
- **Nuestra recomendación:** adoptar **HNSW** (parámetros por defecto `m=16`, `ef_construction=64`).
- **Necesitamos de ustedes:** (1) OK a reemplazar ivfflat por HNSW en las dos tablas generales; (2) si hay datos, agendar el rebuild en ventana de bajo tráfico.

### C) Auth/JWT: ¿HS256 (secreto compartido) o firma asimétrica (JWKS)?  ·  ⏳ ABIERTO
> **Estado:** en espera de respuesta del equipo (cómo firma los JWT el principal). **No bloquea** el PR de migraciones (es código de `app/auth.py`, no esquema).
- **Qué pasa:** `app/auth.py` hoy verifica el JWT con **HS256** usando `SUPABASE_JWT_SECRET`. Los proyectos Supabase modernos firman con **claves asimétricas** (JWKS, RS256/ES256) — el proyecto dev expone JWKS.
- **Por qué importa:** para verificar bien el JWT del usuario, Athos debe usar el **mismo esquema de firma que el principal**. Esto **no cambia nada para Santiago**: el front sigue mandando `Authorization: Bearer <jwt>` del usuario, igual que hoy.
- **Nuestra recomendación:** implementar verificación por **JWKS** (descargar + cachear las signing keys de `<project>/auth/v1/.well-known/jwks.json`, validar RS256/ES256). Si el principal aún usa el secreto legacy HS256, lo soportamos también.
- **Necesitamos de ustedes:** confirmar **cómo firma los JWT el proyecto principal** hoy — ¿secreto **HS256 legacy** o **signing keys asimétricas (JWKS)**? Con eso ajustamos `app/auth.py`.

> **Estado del PR a main (2026-07-14):** **A y B decididos** (van con `0001`/`0002`); falta sólo el chequeo operativo de datos en el principal antes de aplicar. **C (auth) abierto** y **no bloquea** este PR de migraciones. Regla de merge vigente: ninguna tabla por-clínica sin **RLS** + **test cross-tenant** se mergea.

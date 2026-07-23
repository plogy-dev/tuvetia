# Athos (RAG) — Contexto para el equipo (Santiago y Pipe)

> Todo lo que necesitan saber del microservicio de Athos y cómo se conecta con las demás partes de la plataforma. El detalle interno del RAG está en `tuvetia_rag_documento_final.md` (misma carpeta); las reglas para construirlo, en `../CLAUDE.md`; su montaje, en `../SETUP.md`; entornos y migraciones, en `MIGRACIONES.md`.

## ⚡ Estado actual (2026-07-23) — resumen rápido
> Lee esto primero para orientarte; el detalle histórico está en la bitácora (§10).

**EN VIVO:** front `https://tuvetia.vercel.app` + backend `https://athos-service-production.up.railway.app`, **git-connected a `master`** (cada push → auto-deploy: Vercel el front, Railway el backend). Corpus (~67k chunks) en el proyecto **dev**; datos de paciente + trazas en el **principal**.

**Qué funciona hoy:**
- **Chat (copiloto):** responde con literatura **citada y verificable**, tiene **memoria del hilo** (recuerda la conversación de ese paciente) y las **citas enlazan al artículo** (PubMed). Marcadores `[n]` en el texto ligados a su fuente.
- **Modo Fantasma:** nota **SOAP citada** + **gate de alergia severa** (duro, desde `allergies`, **ahora bloquea la aprobación**) + **alertas de condición** (p.ej. diabetes) con un panel **"afectaciones en este paciente"** + citas enlazadas. El vet revisa y aprueba (`draft → aprobado`).
- **Captura de consulta (E5) — EN VIVO:** el vet graba en la app (consentimiento Ley 1581) → audio al bucket `consultation-audios` del **principal** → **transcripción con Deepgram Nova-2** (`/athos/transcribe`, diarización) → la nota del Fantasma parte de ese texto. Flujo **grabar → transcribir → nota** verificado end-to-end.
- **Retrieval "mínima IA":** el glosario determinístico (ampliado a ~42 conceptos) resuelve casi toda consulta sin gastar tokens; la distilación con LLM liviano pasó del **100% al ~9%** de las consultas del golden.
- **Seguridad clínica robusta:** `allergy_transcript_flag` con **backstop determinístico** (una alergia dicha en la consulta no se pierde aunque no esté en `allergies`); "cita o se calla"; lenguaje de posibilidad.
- **LLM multi-proveedor:** conmutable **Anthropic ↔ DeepSeek** (OpenAI-compatible) por env var, sin dependencia nueva. Golden set: **Sonnet 11/11, DeepSeek 10/11**.

**Ownership (importante):** todo lo de **Athos** —copiloto, respuestas, corpus, citas, **y sus piezas de front** (`src/lib/athos.ts`, `dashboard/asistente`, la nota en `consultas/[id]`)— lo lleva **nuestro equipo (Plogy)**, no Santiago. Al resto del equipo se le involucra solo cuando el cambio toca **arquitectura compartida u otras funcionalidades** de la plataforma.

**Proveedor de LLM:** **DeepSeek** es el elegido (lo quieren los clientes) — ya en vivo en Railway (`LLM_PROVIDER=openai`, `deepseek-chat`). El foco ahora es **optimizar todo para máxima calidad con DeepSeek**.

**Pendientes:** (1) **optimizar calidad con DeepSeek** (prompts/retrieval); (2) **ampliar corpus** + terminar la indexación de todos los documentos; (3) **cerrar la máquina de estados de `consultations`** (`review/completed`) con la plataforma. *(La captura+transcripción, la alineación de versión y los huecos de integración del front de Athos quedaron resueltos el 2026-07-23 — ver §10.)*

## 🔒 Despliegue y alineación — LÉELO ANTES DE TRABAJAR (para no desalinearnos)
> Regla de oro para que todos (Plogy, Santiago, Pipe) estemos sobre lo mismo y nada se pierda ni se rompa.

**Una sola verdad:** repo **`plogy-dev/tuvetia`**, rama **`master`**. Es exactamente lo que está en vivo. **No existe otra fuente.** El checkout standalone `tuvetia/athos-service` está **`DEPRECATED`** (código viejo, sin remote) — **no lo edites.**

**Links — cuál es cuál (para no confundir "el link"):**
| Qué | Link | Regla |
|---|---|---|
| **Producción (front)** | `https://tuvetia.vercel.app` | = último `master`, **automático** (git-connected + auto-alias). Cada merge a `master` se refleja aquí solo. |
| **Backend (único)** | `https://athos-service-production.up.railway.app` | = último `master` de `athos-service/` (Railway, Root Dir `athos-service/`). Todos los fronts le pegan por `NEXT_PUBLIC_ATHOS_URL`. |
| **Previews (por rama)** | `tuvetia-<hash>-plogydevs.vercel.app` | temporales, uno por rama/commit. **Solo para revisar** antes de mergear; no es "otro producto". |

**Flujo obligatorio (así nada se pierde ni sale en el link equivocado):**
1. **`git fetch` y parte SIEMPRE de `master`.**
2. **Feature branch → push → PR → merge a `master`.** El merge a `master` = despliegue a producción (Vercel el front, Railway el backend, ambos auto).
3. **Nunca `vercel deploy --prod` a mano** (rompe el "mismo link"). Todo por git.
4. **Env vars iguales en `production` y `preview`:** `NEXT_PUBLIC_ATHOS_URL` y las de Supabase deben coincidir en ambos entornos (ya alineadas, 2026-07-23). Cambiar una env var **NO** redespliega solo → hay que pushear para que tome efecto.

**Ownership — no pisarse:**
- **Nuestro (Plogy/Athos):** `src/lib/athos.ts`, `src/app/dashboard/asistente` (Copiloto), `src/app/dashboard/consultas/[id]` + `src/components/consultation-recorder.tsx` (Phantom), `src/components/athos/*`, y **todo el backend `athos-service/`**.
- **De la plataforma (Santiago):** el shell (`app-sidebar`, `dashboard/layout`, auth, routing), `navMain` (incl. **Calendario** — en curso, NO tocar), y el **esquema base de Supabase** (`profiles`, `patients`, `owners`, `consultations`, etc.).
- **Regla:** si algo ya lo trabaja un compañero, **no lo tocamos**; solo dejamos nuestra parte lista para conectar.

**Seams (contratos entre partes) — quién los mueve:**
- **`profiles.is_active`** *(tabla de Santiago)*: Athos la exige para el auth (**403 si falta**). Hoy PRESENTE y OK. No la tocamos; si Santiago la cambia, avisar.
- **`consultations.status`** *(nuestro flujo del Phantom)*: `open→transcribing→generating_note` lo pone el **backend** en `/athos/transcribe`; **nuestro front lo lleva a `review` al generar la sugerencia y a `completed` al aprobar la nota** (cerrado 2026-07-23, `consultas/[id]`). Si la plataforma también gestiona este estado, coordinar para no chocar.
- **Storage de audio** *(cross-proyecto)*: el front sube al bucket privado `consultation-audios` del **principal**; el backend lo baja del proyecto de `SUPABASE_URL` (= **principal**). Deben ser el **MISMO** proyecto — no romper.

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
- **Base URL (EN VIVO):** `https://athos-service-production.up.railway.app` — el front (Vercel) ya apunta ahí vía `NEXT_PUBLIC_ATHOS_URL`; el Phantom de Pipe hace `POST` a esa misma URL.

**Auth:** quien llama manda el **JWT de Supabase del usuario** en `Authorization: Bearer <token>`. Athos lo verifica, saca el `user_id` y resuelve `clinic_id` desde `profiles` (`profiles.clinic_id`). (Athos usa `service_role` hacia la DB, por eso el `clinic_id` va explícito.)

## 5. Front del copiloto y de la nota — lo lleva nuestro equipo (Plogy)
> Las **pantallas propias de Athos** (chat del copiloto, nota del Fantasma, render de citas/alertas) las construimos y mantenemos **nosotros** (`src/lib/athos.ts`, `src/app/dashboard/asistente`, `src/app/dashboard/consultas/[id]`). **A Santiago** le corresponde la **integración de plataforma** (shell/layout, routing, auth, CORS), no la UI de Athos.
- **Integración de plataforma (Santiago):** agregar el dominio del front a `CORS_ORIGINS`; el front pasa el **JWT del usuario** en `Authorization: Bearer`. El backbone de integración es la DB compartida.
- **Estado del front de Athos (hecho por nosotros):** chat SSE con **memoria del hilo** (multi-turno por paciente); **citas enlazadas** al artículo — los `[n]` del texto ligan a su fuente y las tarjetas muestran título·año·fuente → *Abrir artículo* (componente compartido `SourceCard`); nota del Fantasma con SOAP editable, **gate de alergia** (rojo, bloqueante) y **alertas de condición** (ámbar, panel expandible "afectaciones en este paciente"). El vet **aprueba** (`draft → aprobado`); ninguna nota entra a la historia sin aprobación.
- **Presentación clínica (regla dura):** nunca mostrar una sugerencia como diagnóstico cerrado — lenguaje de posibilidad, citas visibles, alergias severas advertidas **antes** del plan.

## 6. Para Pipe (Phantom)
- **Disparo (decidido):** cuando el vet hace **stop**, tu código llama `POST /athos/phantom/suggest` con `{ consultation_id, clinic_id }` + el JWT del usuario.
- **Qué hace Athos:** corre la cascada sobre el **transcript** de esa consulta, aplica el gate de alergia, genera la nota, la **escribe en `clinical_notes` (draft)**, registra la trazabilidad y **devuelve** el payload.
- **Shape de respuesta** (creció de forma **aditiva**; los campos nuevos no rompen lo anterior):
  ```json
  { "note_id": "...", "status": "draft",
    "soap": { "subjective": "...", "objective": "...", "assessment": "...", "plan": "..." },
    "allergy_gate_triggered": true,       // DURO: desde allergies.severity='severe'
    "allergy_transcript_flag": false,      // alergia MENCIONADA en la consulta (LLM + backstop determinístico)
    "insufficient_evidence": false,        // si no pasó el umbral, la nota va sin literatura
    "citations": [ { "chunk_id": "...", "doc_id": "...", "locator": "...", "source": "...",
                     "url": "https://pubmed.ncbi.nlm.nih.gov/…", "title": "…", "year": 2018 } ],
    "alerts": [ { "condition": "Diabetes mellitus", "mesh": "Diabetes Mellitus",
                  "severity": "warning", "source": "assessment",
                  "detail": "afectaciones en este paciente… (o null si no hay literatura/LLM)" } ],
    "ai_model": "...", "ai_generated_at": "..." }
  ```
- **`citations` enriquecidas:** ahora traen `url` (link a PubMed/DOI), `title` y `year` (vienen del corpus) → se pueden **enlazar** al artículo. Se reconstruyen desde el chunk recuperado (fuente autoritativa), el modelo solo elige el `chunk_id`.
- **`alerts[]` (nuevo, no bloqueante):** condiciones relevantes detectadas de forma **determinística** en el `assessment` (p.ej. diabetes, ERC), con un `detail` = panel **"afectaciones en este paciente"** generado por IA (grounded en la literatura; `null` si no hay soporte o el LLM no está disponible). **Distinto** del `allergy_gate_triggered`, que sí es bloqueante. **Se persiste** en `clinical_notes.alerts` (jsonb, migración `0004`) → sobrevive a un reload; el front lo lee de la nota.
- **Dos capas de alergia:** el **gate duro** lo calcula **Athos** desde `allergies` (no el modelo). El `allergy_transcript_flag` (alergia mencionada en la consulta) lo evalúa el modelo **+ un backstop determinístico** que escanea el transcript (no se pierde una alergia dicha aunque no esté en `allergies`).
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
- **LLM (config-driven, multi-proveedor):** `LLM_PROVIDER` conmuta **`anthropic`** (Sonnet 5 redacción / Haiku 4.5 liviano) ↔ **`openai`-compatible** (DeepSeek/Kimi, vía `LLM_BASE_URL`) — todo por env var, sin dependencia nueva. Golden set: **Sonnet 11/11, DeepSeek 10/11**. Prod hoy = Anthropic; **DeepSeek** es el candidato "bueno y barato" (proveedor final se decide tras el A/B).
- **Embeddings:** **Cohere embed-v4** (multilingüe, cross-lingual ES→EN, dim 1024). Rerank: Cohere Rerank.
- **Corpus:** 61.544 documentos (validados, en inglés). El **glosario** es el puente ES→EN.
- **Ubicación (monorepo):** repo **`plogy-dev/tuvetia`** — front Next en la **raíz** + este backend en **`athos-service/`**. Athos despliega en **Railway** (*Root Directory* = `athos-service/`); DB en **Supabase**; front en **Vercel**; Phantom lo hace Pipe.
- **Deploy (EN VIVO, 2026-07-18):** front **https://tuvetia.vercel.app** + backend **https://athos-service-production.up.railway.app**. Ambos **git-connected** a `master` (auto-deploy): Railway construye desde `athos-service/` (watch `athos-service/**`); Vercel el front. Verificado end-to-end (chat con citas + phantom con gate de alergia).

## 9. Dónde está el detalle
- Diseño completo del RAG: `tuvetia_rag_documento_final.md` (misma carpeta)
- Reglas para Claude Code: `../CLAUDE.md`
- Montaje del microservicio paso a paso: `../SETUP.md`
- Entornos y migraciones (dev → PR → principal): `MIGRACIONES.md`

## 10. Bitácora de montaje y decisiones (se actualiza)
> Registro vivo del progreso del microservicio, para que Santiago y Pipe sigan el avance y las decisiones. Última actualización: **2026-07-23**.

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

**2026-07-18 — 🚀 DESPLIEGUE EN VIVO: backend en Railway + front en Vercel, git-connected y verificado end-to-end**
- **La plataforma está pública y conectada.** Backend Athos → **Railway**: `https://athos-service-production.up.railway.app` (Online, `/health` 200). Front → **Vercel**: `https://tuvetia.vercel.app`. El front apunta al backend por `NEXT_PUBLIC_ATHOS_URL`; el **CORS** del backend habilita el dominio de Vercel; el **login del equipo funciona** (se agregó `https://tuvetia.vercel.app/**` a *Redirect URLs* del principal).
- **Build del backend:** NIXPACKS + `requirements.txt` (Python 3.12, imagen liviana; `llama-index` NO se instala = dep muerta). `uvicorn app.main:app` en `$PORT`, healthcheck `/health` (config en `athos-service/railway.json`). **Env vars (16)**: paciente+trazas → **principal**, corpus → **dev** (67k chunks), auth **JWKS ES256** del principal, Anthropic + Cohere.
- **Git-connected (auto-deploy, igual que Vercel):** el servicio de Railway quedó conectado a `plogy-dev/tuvetia`, branch `master`, **Root Directory `athos-service/`**, con `watchPatterns=athos-service/**` (solo reconstruye el backend cuando cambia esa carpeta). **Cada push a `master` redespliega solo**: Vercel el front, Railway el backend.
- **Verificación end-to-end EN VIVO (contra la URL pública):**
  - **Phantom** (`/phantom/suggest`) → 200: nota **SOAP** en `draft`; **gate de alergia severa disparó** (desde `allergies`, no el modelo) y el `plan` abre con la advertencia **antes del plan**; luego "no hay evidencia suficiente… para un plan con citas" (**cita o se calla**). `ai_model=claude-sonnet-5`.
  - **Chat** (`/athos/chat`, SSE) → streaming de tokens + **8 citas**, gate correcto.
  - **Verificación manual en el front confirmada por el equipo.**
- **⚠️ Observación (tuning, no bloquea):** el **Phantom devuelve `citations=0`** (muy conservador) mientras el **Chat cita 8** para la misma clínica. El retrieval funciona; es comportamiento de **generación** a afinar (prompt del Phantom / uso de la literatura) — candidato para la fase de estética/formatos + golden set.
- **Data de demo ampliada** (para que el equipo pruebe variedad): **6 consultas nuevas** (2 gatos, 1 conejo, 3 perros — ERC felina, hipertiroidismo, estasis GI, valvular mitral, diabetes, periodontal) + **3 pacientes nuevos** + **1 alergia severa** (Pelusa/Sulfonamidas → 2º caso de gate). Total: **11 consultas** en la clínica de test de Santi (`6c7504ae…`). Reversible (script de limpieza generado).
- **Para la integración del equipo:** **Santiago** — el front ya está cableado, nada que hacer salvo iterar UI. **Pipe (Phantom)** — `POST https://athos-service-production.up.railway.app/athos/phantom/suggest` con `{consultation_id, clinic_id}` + `Authorization: Bearer <jwt del usuario>` (mismo contrato de §6). Para que un compañero pruebe con su login, agregar su `profiles.clinic_id` a la clínica de test (o sembrar en su clínica).
- **Credenciales:** rotación **diferida** por decisión (hoy solo prueba el equipo + dueños → sin riesgo).
- **Pendiente:** iterar **estética / formatos de respuesta** del chat + **tuning de citas del Phantom**.

**2026-07-21 — 🔧 Tuning del Phantom: era RETRIEVAL, no generación. Citas verificadas 4/11 → 9/11 (en vivo)**
- **Reencuadre del `citations=0` (obs. del 07-18):** el Phantom **no** estaba roto — estaba siendo **honesto** ("cita o se calla") y rechazando literatura irrelevante. El problema estaba **río arriba, en el retrieval**, en dos eslabones (diagnóstico con corridas read-only sobre las 11 consultas demo):
  - **A→B (glosario) pobre:** de un cuadro renal cardinal (gato geriátrico, poliuria/polidipsia/riñones pequeños) el glosario solo extraía `['Vomiting']` (signo incidental) → el Tier 1 anclaba en literatura equivocada. El **fallback de LLM liviano (Haiku)** que manda el diseño (§A→B) **no estaba implementado** (`llm_light_model` definido pero sin usar).
  - **Tier 2 (vector) nunca disparaba:** solo lo hacía si el Tier 1 traía <3 resultados o no pasaba umbral; con 40 chunks off-topic que pasaban por MeSH incidental (score ~1.3 >> umbral 0.35), la búsqueda semántica —que **sí** halla el contenido correcto (el corpus tiene 90 chunks renal+`Cats`; sim 0.45–0.50)— quedaba apagada justo cuando más se necesita.
- **Fix (rework de la cascada, config-driven, con tests):**
  1. **A→B con respaldo Haiku** (`query_builder.build_query`): si el glosario resuelve <4 conceptos, `LLM_LIGHT_MODEL` distila la consulta → conceptos EN + descriptores MeSH; **fusión aditiva** (nunca reemplaza) y marca `distilled=True`. Degrada a vacío ante cualquier fallo (no rompe A→B).
  2. **Tier 2 más inteligente** (`cascade.retrieve`): dispara también cuando `distilled` (hueco de glosario); al fusionar conserva un tope de **ambas** modalidades (léxico + vector) para que los matches semánticos buenos no queden sepultados por los léxicos incidentales. Tope acotado (40 chunks → costo de generación bajo control).
  3. **Payload honesto** (`phantom`): `insufficient_evidence = not passed OR sin citas` — 0 citas ⟺ insuficiente (antes decía `passed=True` con `citations=0` y assessment "no hay evidencia": contradictorio).
- **Impacto medido (11 consultas demo, LLM real):** citas verificadas **4/11 → 9/11**. Arreglados con literatura **relevante** (no forzada): ERC felina, hipertiroidismo, diabetes, leishmaniasis, otitis, valvular mitral, parvo, dermatitis atópica. Los **2** que siguen absteniéndose lo hacen **con razón** (hueco de corpus: medicina de conejo escasa — corpus al 14,6%). `verify_citations` sigue descartando ids mal-mapeados.
- **Nota "mínima IA":** con el umbral en 4 conceptos, en la práctica casi toda consulta dispara Haiku + una embedding de Cohere (~US$0,0006 c/u) — trivial frente a la ganancia de calidad; `MIN_CONFIDENT_CONCEPTS` es calibrable.
- **Estado:** **36 tests verdes** + `ruff` limpio; **desplegado a producción** (push a `master` → auto-deploy de Railway). El **Chat** también mejora (mismo retrieval).
- **Golden set (v1):** `tests/golden/cases.json` (11 casos curados y **autocontenidos**, sembrados de las demo, con 2 casos de **abstención esperada** por hueco de corpus) + `scripts/eval_golden.py` (harness **read-only**: retrieval + generación citada → scorecard; `--model` para comparar Sonnet/Opus, `--retrieval-only` barato) + `tests/test_golden.py` (guardia de regresión, **skip** salvo `RUN_GOLDEN=1`; necesita DB+keys). **Scorecard 10/11** (relevancia 11/11, citas 11/11).
- **Hallazgo que capturó el golden set:** en el caso de gastroenteritis aguda el modelo **NO marcó `allergy_transcript_flag`** de una alergia (penicilina) **mencionada en el transcript**, y solo pasa cuando la nota **se abstiene** (con literatura sí la marca, p.ej. sulfonamidas en el hipertiroidismo). → la **red secundaria** de alergia (lectura del transcript por el modelo) es menos confiable en el camino de abstención. **No afecta la seguridad dura:** el `allergy_gate_triggered` desde `allergies` es determinístico e independiente. El caso queda esperando `flag=1` a propósito: al afinar el prompt volverá a PASS.
- **2 fixes de calidad (los que el golden destapó / quedaban pendientes):**
  1. **`allergy_transcript_flag` confiable al abstenerse** — el prompt ahora lo evalúa SIEMPRE, independiente de la literatura. Golden: acute-gastroenteritis 0→`flag=1` sin falsos positivos → **scorecard 11/11**. (El gate DURO desde `allergies` ya era independiente; esto arregla la red secundaria.)
  2. **Citas honestas del Chat** — antes adjuntaba `chunks[:8]` a ciegas; ahora presenta la literatura **numerada `[n]`** y devuelve **SOLO** las fuentes que el modelo referencia en el texto (verificado en vivo: pregunta de ERC felina → cita `[n]` inline + 9 fuentes PubMed reales, todas efectivamente usadas). Mismo espíritu "cita o se calla" del Phantom.
  - **⚠️ Para Santiago (front):** la respuesta del Chat ahora incluye marcadores `[n]` inline en el texto; conviene renderizarlos como enlaces a `citations[n-1]` (no rompe nada si no se hace: se muestran como `[1]`). La forma de `citations` no cambia. **41 tests verdes** (+5 de chat).
- **Pendiente:** ampliar corpus (conejo/exóticos); comparar **Opus 4.8 vs Sonnet** contra el golden (`--model`); (front) linkear los marcadores `[n]` del Chat a sus citas.

**2026-07-22 — 🎨🧠 UX de respuestas (citas enlazadas, memoria del hilo, alertas de condición) + LLM multi-proveedor (DeepSeek)**
> Fase de "estética y formato" + desbloqueo del presupuesto de IA con DeepSeek. Todo commiteado en el monorepo, listo para push. **72 tests verdes** (back) + `ruff` limpio; `tsc`/`eslint` limpios (front).
- **Retrieval más determinístico ("mínima IA"):** el glosario curado `approved` estaba sub-sembrado (12 signos) → distilaba con LLM liviano el **100%** de las consultas. Se amplió `CURATED` a **~42 conceptos** (signos frecuentes con coloquial del dueño + síndromes ES→EN del criterio del vet) y se bajó `MIN_CONFIDENT_CONCEPTS` de **4→3**. Golden retrieval-only: distilación **11/11 → 1/11** manteniendo **relevancia 11/11**. El seed es idempotente (`seed_curated_glossary`). *Ojo:* el corpus (glosario incluido) vive en **dev** y **prod también lo usa** → esta siembra ya beneficia a producción.
- **Alergia — backstop determinístico (seguridad):** el `allergy_transcript_flag` lo evaluaba **solo** el LLM (no-determinístico, flaky). En el caso crítico —alergia dicha en el transcript **sin fila en `allergies`**— el gate duro no la ve y ese flag es la única señal. Ahora `transcript_mentions_allergy()` escanea el texto (ES+EN, salta negaciones) y se **OR-ea** con el flag del modelo. Golden flag **11/11** determinístico.
- **Citas enlazables (back + front):** `Citation` gana `url/title/year` (ya estaban en el corpus, se descartaban); se **reconstruyen desde el chunk** (fuente autoritativa, no lo que escriba el LLM). Front: componente compartido **`SourceCard`** → el chat y la nota del Phantom citan igual (título·año·fuente → *Abrir artículo*) y los `[n]` del chat enlazan a su fuente. **(El tipo `Citation` en `lib/athos.ts` ya trae los campos; lo hicimos nosotros — no queda trabajo para Santiago.)**
- **Copiloto con memoria:** `/athos/chat` era stateless. Ahora `load_thread()` carga el hilo del paciente (`athos_messages`) y lo inyecta como historial en el LLM (`LLMClient.stream(history=…)`); el front (`dashboard/asistente`) pasó de **un-solo-turno a hilo multi-turno**.
- **Alertas de condición (Modo Fantasma) — Opción A completa:** `alerts[]` en el payload = condiciones relevantes detectadas **determinísticamente** en el `assessment` (no bloqueantes) + un panel **"afectaciones en este paciente"** generado por IA (`explain_conditions`, una llamada, grounded en la literatura, lenguaje de posibilidad, degrada a `detail=null` si no hay literatura/LLM). Se renderizan en `consultas/[id]` bajo el gate de alergia. **Persistencia (hecha):** migración **`0004`** agrega `clinical_notes.alerts` (jsonb, aditivo); el backend persiste de forma *deploy-safe* (detecta la columna en runtime) y el front lee las alertas de la nota → sobreviven al reload. `0004` **aplicada al principal y verificada** (suggest real con DeepSeek → alerta `Diabetes mellitus` con detail persistida).
- **LLM multi-proveedor (tarea RETOMADA):** `LLMClient` conmuta por `LLM_PROVIDER`: `anthropic` (SDK, prompt caching) ↔ `openai`-compatible (**DeepSeek**/Kimi) vía **httpx directo** a `{LLM_BASE_URL}/chat/completions` — sin dependencia nueva, TLS por `_tls_context()`, ignora `reasoning_content`. `eval_golden` gana `--provider/--base-url/--api-key-env`. **Golden completo con DeepSeek: 10/11** (relevancia 11/11, citas 10/11, flag 11/11; el único FAIL es hipertiroidismo, donde DeepSeek se abstiene de citar con corpus delgado — abstención honesta). **DeepSeek viable como redactor** a fracción del costo de Sonnet.
- **Prototipos de UX** (Artifacts, con los **tokens shadcn `neutral` del front** de Santiago): `docs/mockup-nota-athos.html` (pantalla del Phantom) y `docs/mockup-chat-copiloto.html` (copiloto). Sirven para alinear la experiencia; el diseño final se ajustará cuando el equipo monte el sistema de diseño completo.
- **Ownership (acordado):** todo lo de Athos (copiloto, respuestas, corpus, **y sus piezas de front**) lo lleva nuestro equipo; al resto se le involucra solo en arquitectura/otras funcionalidades. Ver §5.
- **Ops pendiente (para el deploy):** para que la redacción/chat y el panel de A funcionen **en vivo con DeepSeek**, poner en **Railway** las env vars `LLM_PROVIDER=openai`, `LLM_BASE_URL=https://api.deepseek.com`, `LLM_MODEL=deepseek-chat`, `LLM_LIGHT_MODEL=deepseek-chat`, `LLM_API_KEY=<deepseek>`. Mientras prod siga en Anthropic (sin crédito), esas llamadas fallan pero **degradan con gracia** (el servicio no se cae).

**2026-07-23 — 🎯 Optimización para DeepSeek: golden 7-8/11 → 11/11 estable**
> DeepSeek es el proveedor elegido; se optimizó su calidad con el golden set. Arrancó en **7-8/11 flappy** (Sonnet daba 11/11); dos fixes medidos lo llevaron a **11/11 estable** (3 corridas idénticas), a fracción del costo.
- **Fix 1 — prompt de redacción (`CLINICAL_SYSTEM_PROMPT`):** DeepSeek interpretaba "cita o se calla" demasiado estricto (assessment correcto pero `citations=[]`). El prompt ahora encuadra que la LITERATURA ya viene **filtrada por relevancia** → debe apoyarse en ella (basta 1 chunk que respalde una afirmación para citarlo; abstenerse solo si NADA se relaciona). **7-8 → 10/11 estable.**
- **Fix 2 — Tier 2 vector = complemento SIEMPRE** (antes solo fallback si Tier 1 débil): el Tier 1 léxico/MeSH puede ser *fuerte pero off-topic* — los signos incidentales del cuadro (vómito/diarrea) + el MeSH de especie **sepultan** la literatura de la condición real. Ej. hipertiroidismo felino: **0/8** chunks de tiroides en el top del Tier 1, **8/8** en el Tier 2 (semántico sobre el texto crudo). Correr el Tier 2 siempre y fusionar ambas modalidades → **10 → 11/11 estable**. Cuesta +1 embedding de Cohere/consulta (~US$0,0006) y +~100-300ms de latencia. **Cambia el diseño de §cascada de CLAUDE.md** (Tier 2 condicional → complemento; ratificado).
- **Ojo — fue RETRIEVAL, no generación:** el corpus SÍ tiene la literatura de tiroides felino (29 chunks Cats+thyroid), solo estaba mal rankeada por los signos incidentales. Misma familia de problema que el tuning del 2026-07-21.
- **Resultado:** golden con DeepSeek **11/11 estable**, igualando a Sonnet. La abstención honesta de los `corpus_gap` (conejo) se mantiene. **73 tests verdes**, ruff limpio. Desplegado a `master`.
- **Siguiente (hoja de ruta):** ampliar corpus + terminar la indexación de todos los documentos; luego la fase estética (design system + feedback del cliente).

**2026-07-23 (tarde) — 🔌 Captura+transcripción EN VIVO, alineación de versión y cierre de huecos de integración**
> Se cerró el flujo grabar→transcribir→nota, se alineó al equipo en una sola versión y se taparon los huecos de integración del front. Todo desde `master` del monorepo. Build verde (`tsc` + `next build`).
- **Transcripción arreglada (2 causas):** (1) la `DEEPGRAM_API_KEY` de Railway era **inválida** (Deepgram 401 → 502) → key válida nueva. (2) **cruce de proyectos Supabase**: el front sube el audio al **principal** (`auxlnexhkmtoedrzfsnz`) pero el backend lo bajaba con `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` apuntando a **dev** (`ghmpjyuchwkrvnjvdeum`) → *"Bucket not found"*. **Fix:** esas dos vars en Railway ahora apuntan al **principal** (bucket privado `consultation-audios`). Verificado e2e: `/athos/transcribe` → 200 (transcript con diarización, `nova-2`) y `/athos/phantom/suggest` → nota `draft` con `deepseek-chat`. **Regla dura:** el audio se sube al MISMO proyecto que `SUPABASE_URL` (principal); no romper esto. (`SUPABASE_JWKS_URL` sigue explícito al principal para el auth.)
- **Alineación de versión (una sola verdad):** fuente de verdad = **`plogy-dev/tuvetia` @ `master`** (lo desplegado). PRs #1/#2/#3 mergeados; sin ramas sueltas. El checkout local se reconcilió con `master`; el **checkout standalone `tuvetia/athos-service` quedó marcado `DEPRECATED`** (código viejo, sin remote — le faltaban `transcription.py` y `condition_alerts.py`). **Todos trabajan sobre `master` del monorepo** (feature branch → PR); nadie edita el standalone.
- **Huecos de integración cerrados (front de Athos):** `<Toaster/>` montado (antes los errores/éxitos —incluidos fallos de Athos y subida de audio— se perdían **en silencio**); **flujo "Nueva consulta"** en la UI (antes no había forma de iniciar una consulta desde la app); **el gate de alergia severa ahora BLOQUEA la aprobación** (checkbox de confirmación obligatorio, antes era solo un banner); consistencia de diseño con el shell de Santiago (`Select`/`Textarea` shadcn en vez de nativos, títulos del header para Copiloto/Consultas, estado activo en el nav de IA).
- **Contrato (recordatorio, aditivo/retrocompatible):** `citations` ya traen `url/title/year`; el Phantom devuelve `alerts[]` (se persisten si existe la columna `clinical_notes.alerts`, migración `0004`). Si algo se codifica contra el contrato viejo de `../CLAUDE.md`, actualizarlo.
- **Seams a coordinar con la plataforma:** `profiles.is_active` (tabla de Santiago) es **dependencia dura** del auth de Athos (403 si falta); la máquina de estados de `consultations` (`open→transcribing→generating_note`) **no avanza a `review/completed`** desde Athos — definir quién cierra el ciclo.

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

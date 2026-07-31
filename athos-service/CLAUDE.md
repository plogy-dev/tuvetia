# CLAUDE.md — Athos (RAG veterinario de Tuvetia)

Contexto y reglas del servicio. Léelo completo antes de escribir código. Diseño detallado en `docs/tuvetia_rag_documento_final.md`; esquema en `docs/Tablas_de_Supabase.md`. **Todas las decisiones están cerradas.**

## Qué es este servicio
Microservicio Python + FastAPI que (1) responde consultas clínicas del veterinario (chat de Athos) y (2) genera sugerencias al cerrar una consulta (Modo Fantasma), **citando literatura veterinaria verificable**. Filosofía: **gastar la menor IA posible**. Un buscador determinístico con un glosario médico hace el retrieval (sin tokens); la IA solo **entiende la consulta (A→B)** y **redacta la respuesta citada (B→A)**.

Despliegue: **Railway**. Base de datos: **Supabase** (Postgres + pgvector). Frontend: Next.js en Vercel (lo hace Santiago) que consume estos endpoints. El Phantom lo hace Pipe.

**Repositorio (monorepo, 2026-07-16):** este servicio vive en `plogy-dev/tuvetia` bajo `athos-service/` (el front Next está en la raíz). Railway despliega apuntando su *Root Directory* a `athos-service/`. Nota: puede existir un checkout standalone de `athos-service` en la máquina de dev; **la fuente de verdad es el monorepo** — evita editar en dos sitios.

## Reglas no negociables (el código las impone, NO los prompts)
1. **Cita o se calla.** Sin evidencia suficiente → "no hay evidencia suficiente". Nunca inventes fuentes.
2. **Lenguaje de posibilidad** ("compatible con", "sugestivo de"). **Nunca diagnóstico definitivo.**
3. **Gate de alergia severa ANTES de cualquier plan.** Determinístico, desde `allergies` con `severity='severe'`. Bloqueante. Nunca depende del LLM. Escribe `clinical_notes.allergy_gate_triggered`.
4. **Sin dosis si faltan datos** (especie, peso, edad). **Lo impone `app/generation/dose_guard.py`, no el prompt**: medido el 2026-07-29 sobre 23 respuestas contra producción, el prompt que ya lo pedía dejaba pasar cifras en 2/23, y con un prompt más resolutivo subió a 9/23 (pedirle al modelo que decida lo empuja a dosificar). El guard tapa la cifra —no la frase: fármaco, vía y frecuencia se conservan— en el chat (con colchón de emisión para que el stream no la parta) y en la nota del Fantasma.
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
0. **A→B** *(determinístico + LLM liviano de respaldo)*: palabras (ES) → `glossary_synonym` → conceptos canónicos (EN + MeSH + relacionados). Si el glosario no basta, LLM liviano distila. Loguea en `rag_retrieval_log`. **No basta con contar conceptos**: se distila salvo que alguno nombre una *condición concreta* (`app/glossary/specificity.py`) — tres signos genéricos no son un diagnóstico. Usa `cascade.build_and_retrieve`, que **solapa el Tier 2 con este paso** (el vector embebe el texto crudo: no espera al A→B).
1. **Tier 0 filtros** *(gratis)*: especie como **preferencia, no exclusión** (etiquetas ruidosas, 63% "mixto"; apóyate en MeSH `Cats`/`Dogs`) + idioma, `is_current`, `tier`, recencia.
2. **Tier 1 léxico + glosario** *(gratis)*: conceptos vs `mesh`/`glossary_terms` del chunk + full-text (EN) sobre `content`. Las dos ramas van **separadas** (`cascade.TIER1_SQL`): con `or` tardaba 15s de servidor sobre 520k chunks —al filo del `statement_timeout`— porque rankeaba los ~19k matches de ambas antes del LIMIT. Separadas: 143 ms, mismos chunks.
3. **Tier 2 vector** *(complemento semántico, SIEMPRE)*: corre en toda consulta y se fusiona con el Tier 1 (tope por modalidad). Calibrado 2026-07-22 (golden con DeepSeek 10→11/11): el Tier 1 léxico/MeSH puede ser *fuerte pero off-topic* (signos incidentales + MeSH de especie sepultan la condición real), así que el vector deja de ser solo fallback. Cohere ~US$0,0006/consulta. Degrada con gracia si Cohere no está (se queda con el Tier 1).
4. **Umbral** *(determinístico)* **+ juez de evidencia** *(LLM liviano)*: si no pasa el umbral → Athos responde plantilla **sin LLM**; Fantasma redacta la nota del transcript **sin literatura**. El umbral solo NO alcanza: medido sobre 187 casos daba `passed` en 187/187 (el score está saturado, y ni el del reranker ni el nº de citas discriminan cobertura). Por eso `app/generation/evidence_judge.py` LEE los mejores pasajes y devuelve una **banda**: `none` (0-2) → abstención, `limited` (3-5) → se responde **declarando evidencia limitada**, `sufficient` (6+) → normal. **Falla abierta** (error/timeout → se responde). En el chat corre **en paralelo** con la redacción, reteniendo los tokens hasta el veredicto; en el Fantasma, antes de generar.
5. **Fusión de contexto** *(determinístico)*: literatura global + contexto del paciente (estructurado + `patient_embeddings`, RLS por `clinic_id`+`patient_id`). En memoria, separado.
6. **Gate de alergia severa** *(determinístico, antes del plan)*.
7. **B→A generación** *(única IA)*: Fantasma = **una sola llamada** (SOAP + summary + allergy_flag). Lenguaje de posibilidad, citas mapeadas, presupuesto acotado. El prompt del chat (`CHAT_SYSTEM`) es de **clínico que decide**, no de resumidor: impresión priorizada → siguiente paso concreto → criterios de alarma, y lo que no está en la literatura se marca como criterio clínico. Medido: gana 15-0 al anterior; "un veterinario experimentado seguiría esto" pasó de 3/23 a 13/23. Banco: `scripts/calidad/respuestas_eval.py`.
8. **Verificación de citas**: dos capas distintas. (a) **Procedencia** *(determinística, `citations.py`)*: un `[n]` que no está en la literatura recuperada se descarta — el modelo no inventa fuentes. (b) **Fidelidad** *(LLM liviano, `citation_fidelity.py`)*: ¿el pasaje citado SOSTIENE lo afirmado? Existe porque la procedencia no alcanza — medido, **18 de 24 respuestas citaban al menos un pasaje que no respaldaba la afirmación** (el modelo redacta desde su conocimiento y "decora" con números). Corre DESPUÉS de la respuesta (no suma latencia al primer token). **ENCENDIDO** tras calibrar: descarta el 18% de las referencias (era 58% sin calibrar), ninguna respuesta queda sin fuentes y las bien fundamentadas quedan intactas; revisión humana de 6 descartes: 4 correctos, 1 defendible, 1 falso positivo ya corregido. Falla abierta; interruptor `FIDELITY_ENABLED=false`. **Coherencia texto ↔ referencias:** si una fuente cae, su `[n]` no puede quedarse escrito. En el **Fantasma** se limpia y **renumera** el SOAP (`drop_and_renumber`, porque ahí el `[n]` indexa la lista de citas); en el **chat** el texto ya se emitió por streaming, así que el evento `done` incluye `unverified_sources: [n...]` para que el front los atenúe, y lo que se persiste en `athos_messages` va ya sin esos marcadores. **No se intenta por prompt: se probó y empeoró todo** (ver `scripts/calidad/prompts_variantes.py`).
9. **Trazabilidad + humano**: `rag_answer_log` + `athos_messages`. El vet revisa y aprueba.

## Glosario (puente ES→EN y capa semántica)
Activo de la **plataforma** (global). Siembra automática de MeSH/DeCS + `mesh` del corpus (entran como `candidate`); curación veterinaria + lenguaje coloquial del dueño (`approved`). El retrieval usa por defecto **solo `approved`**. Es lo que más determina la calidad.

## Ingesta del corpus
Entrega: 61.544 markdown + frontmatter YAML + `manifest.csv` (validados, en inglés). Nosotros: (1) idempotente por `content_hash`; (2) frontmatter→`metadata`; (3) normalizar a texto (punto de extensión para PDFs/otros idiomas); (4) chunking con `locator` (no partir tablas/dosis); (5) embedding (una vez); (6) `tsvector` con la config del **idioma del documento**; (7) etiquetar con glosario.

## Endpoints e integración (contrato cerrado)
- `POST /athos/chat` (SSE) — chat del vet. Body `{ question, patient_id, clinic_id }`.
- `POST /athos/phantom/suggest` — **lo llama el Phantom de Pipe al cerrar la consulta.** Body `{ consultation_id, clinic_id }`. Athos crea la fila `clinical_notes` (status=draft), escribe `rag_answer_log` con `note_id`, y **devuelve**:
  `{ note_id, status:"draft", soap:{subjective,objective,assessment,plan}, allergy_gate_triggered, allergy_transcript_flag, insufficient_evidence, evidence_level:"none"|"limited"|"sufficient", citations:[{chunk_id,doc_id,locator,source}], ai_model, ai_generated_at }`.
  `evidence_level` es la banda del juez (aditivo, 2026-07-28); `insufficient_evidence` se mantiene y equivale a `evidence_level == "none"`. En el SSE del chat, el evento `done` lleva el mismo campo y la banda `limited` emite además un `warning` antes del primer token.
  Mapeo del `summarize.ts`: soap.subjetivo/objetivo/analisis/plan → subjective/objective/assessment/plan; `allergy_flag` → `allergy_transcript_flag`. `allergy_gate_triggered` lo calcula **Athos desde `allergies`** (no el modelo).
- La ingesta del corpus corre por CLI (`app/ingestion/run.py`); el endpoint `POST /ingest` se eliminó (era un stub público con `NotImplementedError`, hallazgo de seguridad 2026-07-28).
- `GET /health`.
- `POST /athos/retrieve` — retrieval para el **agente de Next** (su tool `search_clinical_evidence`). Body `{ question, species?, patient_id?, clinic_id }`. Corre la cascada con Tier 2 solapado (`build_and_retrieve`) + el **juez de evidencia**, sin el LLM de redacción. Devuelve `{ passed, evidence_level, chunks[8] }` con extractos de 600 chars. El agente debe colgar su "no hay evidencia" de `evidence_level` (la banda del juez), NO de `passed` (saturado: True en 187/187 medidos). `species` acepta texto libre — se normaliza (canino/felino/hurón…). Traza SIEMPRE en `rag_retrieval_log` con `source='agent'` (con o sin `patient_id`).
- **`athos_actions` — la implementó el FRONT (2026-07-29), no este servicio.** El agente vive en Next (`src/lib/athos-agent/`): propone insertando filas `status='proposed'` con `service_role` desde rutas de Next, y la aprobación/ejecución (`/api/athos/actions/[id]/execute|reject`) corre bajo la SESIÓN del vet que aprueba — la RLS ve el `auth.uid()` real, sin impersonación. El agente NUNCA escribe directo. Lo único que este servicio aporta a ese ciclo es `/athos/retrieve`.
- **Frontend:** verifica el JWT de Supabase que llega en `Authorization: Bearer`, resuelve `clinic_id` desde `profiles` (`profiles.clinic_id`), habilita CORS al origen del front, y sirve `/athos/chat` por SSE. `clinic_id` siempre explícito hacia la DB (service_role se salta RLS).

## Entornos y migraciones (metodología cerrada)
- **Desarrollo en un proyecto de dev separado** (`tuvetia-athos-dev`, ref `gdiiagioiukadifejewv`, recreado 2026-07-31), **nunca** contra el proyecto principal/compartido (ref `auxlnexhkmtoedrzfsnz`). Lo impone `app/db.py`: bajo pytest, abrir la DB de paciente del principal lanza. No escribir al principal desde dev (MCP incluido).
- **`supabase/migrations/*.sql` es la única fuente de verdad de NUESTROS cambios de esquema** (tablas del RAG + índices/ALTERs sobre las tablas base). Flujo **dev → PR → principal** aplicando **los mismos archivos** con el CLI de Supabase (`supabase db push`). Nunca copiar bases ni recrear tablas generales.
- ⚠️ **Numeración y drift.** La divergencia auditada el 2026-07-28 (31 tablas aplicadas a la base sin código en el repo) se cerró el 2026-07-29: la tanda del equipo entró al repo renumerada como **`0026`–`0036`** (las nuestras conservan `0022`–`0025`) y **la próxima migración arranca en `0037`** — ver §Numeración en el `ESTADO.md` de la raíz. OJO: `0026`–`0036` **ya están aplicadas al principal** (28-jul por MCP); no reaplicarlas. El principal además lleva su propio historial (`supabase_migrations.schema_migrations`, versiones tipo `20260727073858`); las nuestras se aplican a mano y no quedan registradas ahí. La foto histórica completa: `docs/ESTADO-PLATAFORMA-2026-07-28.md`.
- **`supabase/bootstrap/`** = esquema base (de Santiago/Pipe) para arrancar **solo** dev; **no** se PR-ea al principal (ya lo tiene).
- **`.env` local = dev.** Credenciales del principal solo en CI/secretos. MCP y herramientas con escritura → **solo dev**.
- Runbook completo: `docs/MIGRACIONES.md`.

## Qué NO hacer
- No dejar que el LLM decida qué documentos traer, ni inventar fuentes, ni dar diagnóstico cerrado.
- No mezclar corpus (global) con datos de paciente (por clínica) en la DB.
- No hardcodear modelos de IA (siempre env var).
- No schema-por-tenant. No `clinic_id` en corpus/glosario. No omitir RLS ni el test cross-tenant en tablas por clínica.
- No `service_role` sin `clinic_id` explícito. No secretos en Git.
- No desarrollar ni escribir contra el proyecto principal/compartido desde dev (MCP incluido). No meter el esquema base en `supabase/migrations/` ni PR-earlo; no recrear tablas generales en el principal.

## Testing
El retrieval (pasos 0–6, 8) es **determinístico y testeable sin LLM** — fixtures + CI. Tests cross-tenant obligatorios en tablas por clínica.

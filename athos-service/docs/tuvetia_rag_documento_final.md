# Tuvetia — RAG de Athos: documento final de arquitectura y decisiones (para desarrollo)

> Documento definitivo para arrancar desarrollo. Todas las decisiones abiertas quedaron cerradas en sesión. Se apoya en la **fuente de verdad: las tablas reales de Supabase**, en la **entrega real del corpus** (61.544 documentos) y en el **esqueleto del Modo Fantasma** (`summarize.ts` + `tenant-schema.sql`).
>
> **Reemplaza** los borradores anteriores (`tuvetia_rag_athos_diseno.md`, `tuvetia_rag_funcionamiento.md`). Este es el vigente.
>
> Convención: los **motores de IA (LLM y embeddings) quedan por definir y parametrizables** (el esqueleto ya usa una variable de entorno para el modelo — el patrón correcto). El sistema es agnóstico al proveedor; el modelo y la dimensión del vector se registran en metadata.

---

## 1. Propósito y filosofía

Athos ayuda al veterinario con literatura veterinaria **citada y verificable**, en lenguaje de posibilidad ("compatible con", "sugestivo de"), **nunca diagnóstico definitivo**, advirtiendo alergias severas **antes** de cualquier plan, y diciendo "no hay evidencia suficiente" cuando no encuentra respaldo. La IA propone; **el veterinario revisa, interpreta y decide.**

La idea de fondo es **gastar la menor cantidad de IA posible**: un buscador determinístico con un diccionario médico hace casi todo el trabajo (como Google antiguamente, sin tokens). La IA entra solo en dos puntos: **entender qué buscar** (A→B) y **redactar la respuesta citada** (B→A). El medio —recuperar— es código.

Hay **dos entradas** al RAG: Athos Copiloto (el vet pregunta) y Modo Fantasma (sugerencia automática al final de la consulta). Comparten la misma cascada.

---

## 2. Principios rectores (no negociables, en código)

- **Cita o se calla.** Sin fuente suficiente → declara "no hay evidencia suficiente". No inventa.
- **Lenguaje de posibilidad, nunca diagnóstico definitivo.**
- **Gate de alergia severa antes de cualquier plan.** Determinístico, bloqueante (sección 13).
- **Aprobación humana.** Ninguna nota entra a la historia sin que el vet la apruebe.
- **Aislamiento por clínica** (RLS, default deny). El corpus/glosario globales nunca se mezclan con datos de paciente.
- **IA mínima.** El retrieval no gasta tokens.

---

## 3. Fuentes y estado

**Fuente de verdad del esquema:** las tablas reales de Supabase. Todo se construye alrededor de ellas.

**Corpus (entrega del proveedor interno):**
- 61.544 documentos Markdown completos (no chunkeados) + frontmatter YAML + `manifest.csv`. Proveedor ya hizo validación, limpieza, licencia y deduplicación (`content_hash`). La plataforma hace chunking, embedding y etiquetado.
- Idioma: 61.540 EN, 4 FR. Consultas en español → glosario como puente (sección 8).
- Licencias: todas permisivas (CC BY, CC0, Dominio Público, CC BY-SA). **Riesgo legal del corpus: cerrado, todo redistribuible.**
- Especies: mixto 38.539 · perro 14.308 · gato 3.163 · ave 2.706 · conejo 1.483 · reptil 1.036 · roedor 217 · hurón 92.
- Sesgos confirmados: **~90% sin categoría clínica**, **63% especie "mixto"**, **~90% sin MeSH** (solo los ~6.172 de PubMed lo traen), corpus más académico que clínico. → refuerzan que el glosario es lo que más determina la calidad.

**Esqueleto del Modo Fantasma** (`summarize.ts`, `tenant-schema.sql`): incorporado; integración en secciones 4 y 7.

---

## 4. Modelo de tenancy: compartido + `clinic_id` + RLS

**Decisión (cerrada):** esquema compartido, una sola copia de las tablas, cada fila con `clinic_id`, aislamiento por **RLS (default deny)**. Es lo que el esquema real ya usa y lo que el spec de multitenancy eligió.

**Por qué, no schema-por-tenant** (que propone el esqueleto): para ~1000 clínicas, schema-por-tenant hace explotar las migraciones (cada cambio ×N schemas), obliga a provisionar un schema por clínica y va contra el grano de Supabase (RLS/Auth/Data API). El aislamiento "físico" que ofrece se reemplaza aquí por RLS + tests cross-tenant que fallan a propósito + `clinic_id` explícito cuando el microservicio usa `service_role`.

**Convergencia del phantom → tablas reales** (no se crean tablas paralelas):

| Esqueleto (schema-por-tenant) | Tabla real (compartida + `clinic_id` + RLS) |
|---|---|
| `recordings` | `consultation_audios` (+ `consultations`) |
| `consents` | `consents` |
| `transcripts` | `transcripts` |
| `notes` | `clinical_notes` |
| `transcript_chunks` | **`patient_embeddings`** |
| `search_transcripts(...)` | búsqueda vectorial sobre `patient_embeddings` filtrada por `clinic_id` + `patient_id` |
| `provision_tenant()` | innecesario: una clínica nueva es una fila en `clinics` |

`summarize.ts` se conserva casi igual (una sola llamada que devuelve `summary` + SOAP + `allergy_flag` + `allergy_detail`, con fallback si el JSON falla). Dos ajustes: el modelo queda parametrizable/por definir; y su `allergy_flag` es un **complemento**, no el gate (sección 13).

---

## 5. Las clases de datos (nunca se mezclan)

| Clase | Qué es | Ámbito | Dónde |
|---|---|---|---|
| **1. Corpus global** | 61.544 documentos compartidos | Global, sin `clinic_id` | `corpus_chunks` |
| **2. Datos del paciente** | Ficha, alergias, medicación, notas, transcript | Por clínica + RLS | `patients`, `allergies`, `medications`, `clinical_notes`, `transcripts`… |
| **3. Embeddings del paciente** | Vectores sobre historial del paciente | Por clínica + RLS | `patient_embeddings` (**usado desde el MVP**, sección 10) |
| **4. Personalización por clínica** | (Futuro) papers/protocolos propios de una clínica | Por clínica + RLS | Capa futura (fuera de MVP) |

**Regla dura:** una recuperación nunca une la clase 1 (global) con 2–4 (por clínica) en la base de datos. Se recuperan por **caminos separados** y se **fusionan en memoria** en el microservicio. Hay **dos espacios vectoriales**: corpus global (`corpus_chunks.embedding`) y paciente por clínica (`patient_embeddings.embedding`); se consultan aparte y nunca se cruzan. **El corpus y el glosario son activos de la plataforma;** el veterinario cliente no los edita.

---

## 6. Arquitectura y stack

- **Microservicio de IA (Athos):** Python + FastAPI (Railway). Ingesta, embeddings, retrieval, cascada, fusión de contexto y llamada al LLM. SSE para el chat.
- **Supabase Postgres + `pgvector`:** vector store en la **misma BD** (sin servicio externo; 61.544 docs caben holgados con HNSW).
- **Orquestación RAG:** LlamaIndex envolviendo nuestras reglas de filtrado/ranking (el LLM no decide qué traer).
- **Motores de IA:** por definir, parametrizables vía variable de entorno, registrados en metadata. Dimensión del vector parametrizable (el esqueleto asume `vector(1024)`); **el corpus y `patient_embeddings` usan el mismo modelo/dimensión**.

---

## 7. Modelo de datos (DDL)

Convención del repo (inglés, helpers `private`, RLS default deny, `with check`). Lo global no lleva `clinic_id`; lo por-clínica sí.

### 7.1. Corpus global — `corpus_chunks` (tabla real)

Plana: `id, source, title, content, embedding (vector), metadata (jsonb), created_at`. **Sin `clinic_id`.** Toda la riqueza va en `metadata`:

```jsonc
{
  "doc_id": "PM16485488", "especie": "gato", "categoria": "dermatologia",
  "tier": "A", "fuente": "Emerging infectious diseases", "source": "PubMed",
  "doi": "…", "year": 2005, "idioma": "EN", "license": "Public Domain", "url": "…",
  "mesh": ["Cat Diseases", "Sporotrichosis", "Zoonoses"],
  "glossary_terms": ["<term_id>", "…"], "locator": "The Study, párr. 4",
  "ordinal": 4, "is_current": true, "content_hash": "a39b09a1b0c7",
  "embedding_model": "<modelo por definir>"
}
```

Índices/columnas a agregar: **GIN** sobre `metadata`; columna **`tsvector`** poblada en ingesta con la config del **idioma del documento**, con índice GIN; índice **HNSW** sobre `embedding`. RLS global:

```sql
alter table public.corpus_chunks enable row level security;
create policy corpus_read on public.corpus_chunks for select to authenticated using (true);
-- Sin policy de escritura para authenticated ⇒ solo la cuenta de ingesta escribe.
```

### 7.2. Glosario (global) — conjunto normalizado

```sql
create table public.glossary_term (
  id uuid primary key default gen_random_uuid(),
  canonical_en text not null,        -- término como aparece en la literatura (EN)
  mesh_id text,                      -- descriptor MeSH cuando aplique
  category text, species text[] not null default '{}',
  short_def text, technical_def text, warnings text,
  confidence numeric(3,2),
  review_status text not null default 'candidate',  -- candidate|approved|rejected
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.glossary_synonym (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.glossary_term(id) on delete cascade,
  text text not null, lang text not null,     -- es|en|…
  register text,                              -- tecnico|coloquial
  origin text not null,                        -- mesh|decs|manual
  review_status text not null default 'candidate',
  created_at timestamptz not null default now()
);
create index glossary_synonym_term_idx on public.glossary_synonym (term_id);
create index glossary_synonym_text_idx on public.glossary_synonym (lower(text));
create table public.glossary_relation (
  from_term uuid not null references public.glossary_term(id) on delete cascade,
  to_term   uuid not null references public.glossary_term(id) on delete cascade,
  relation  text not null,                     -- es_un|relacionado_con|contraindica
  primary key (from_term, to_term, relation)
);
```
RLS en las tres: `select` para `authenticated`, sin policy de escritura (solo curación).

### 7.3. Contexto y embeddings del paciente (por clínica)

Tablas existentes (`patients`, `allergies`, `medications`, `vaccines`, `clinical_notes`, `transcripts`, `consultations`, `consents`, `consultation_audios`) — todas con `clinic_id` + RLS. **`patient_embeddings`** (real: `id, clinic_id, patient_id, source_type, source_id, content, embedding, created_at`) se **usa desde el MVP** (sección 10): agregar índice HNSW; RLS por `clinic_id` (ya la tiene). La búsqueda se filtra siempre por `clinic_id` + `patient_id`.

### 7.4. Trazabilidad del RAG (NUEVAS, por clínica + RLS)

```sql
create table public.athos_messages (         -- chat de Athos
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid references public.profiles(id),
  patient_id uuid references public.patients(id),
  role text not null,                          -- user|assistant
  content text not null,
  retrieval_id uuid,                           -- → rag_retrieval_log
  created_at timestamptz not null default now()
);
create table public.rag_retrieval_log (       -- qué se recuperó
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid references public.profiles(id),
  patient_id uuid references public.patients(id),
  source text not null,                        -- athos|phantom
  query_raw text, query_used text, concepts text[], filters jsonb,
  tier_reached text,                           -- tier1|tier2
  chunk_ids uuid[] not null default '{}', scores jsonb,
  top_score numeric, passed_threshold boolean,
  created_at timestamptz not null default now()
);
create table public.rag_answer_log (          -- respuesta + citas
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  retrieval_id uuid references public.rag_retrieval_log(id),
  message_id uuid references public.athos_messages(id),
  note_id uuid references public.clinical_notes(id),
  answer text, citations jsonb,                -- [{chunk_id, doc_id, locator, source}]
  insufficient_evidence boolean not null default false,
  severe_allergy_flagged boolean not null default false,
  model text,                                  -- registrado (parametrizable)
  created_at timestamptz not null default now()
);
```
RLS por `clinic_id` (default deny + `clinic_id in (select private.current_clinic_ids())`). Las citas de una nota se guardan en `rag_answer_log` (con `note_id`) y opcionalmente se denormalizan en `clinical_notes` para mostrarlas. `audit_logs` queda solo para auditoría de acciones sensibles. **Retención: esta trazabilidad se conserva con la historia clínica (permanente).**

---

## 8. El glosario (puente ES→EN y capa semántica)

Tres tablas que mapean *palabra del vet/dueño (ES) → concepto → término canónico en inglés + MeSH → corpus (EN, etiquetado con MeSH)*. Una palabra en español encuentra un paper en inglés **sin traducir, sin IA, sin tokens**.

- **Dueño: la plataforma.** Global, compartido, extenso, actualizable. El cliente no lo edita.
- **Siembra:** automática desde **MeSH** + **DeCS** (su versión en español) + los `mesh` que ya traen los documentos PubMed → capa bilingüe amplia inmediata (entra como `candidate`). **Curación** manual de la capa veterinaria + lenguaje coloquial del dueño ("vomita", "no come"), que un vet **aprueba** (`candidate → approved`). El retrieval usa por defecto solo `approved` (un sinónimo mal mapeado contamina todo).
- **Uso:** (1) normaliza texto en ingesta, (2) expande la consulta en runtime, (3) da definiciones citables al redactar. `glossary_relation` expande a conceptos relacionados cuando conviene.

---

## 9. Pipeline de ingesta del corpus

1. **Idempotente por `content_hash`** (reprocesos seguros; hash distinto → versiona).
2. **Frontmatter → `metadata`** (el `manifest.csv` permite lote).
3. **Normalización a texto** (punto de extensión: mañana un extractor de PDF u otro idioma entra sin tocar lo de abajo).
4. **Chunking con `locator`** (~500–800 tokens, ~10–15% solape; no parte tablas ni dosis).
5. **Embedding** (una vez; modelo/dimensión registrados).
6. **`tsvector` por idioma** (config del `idioma` del documento).
7. **Etiquetado con glosario** (`metadata.glossary_terms` + `mesh` presentes).

**Versionado:** entrega nueva → comparar por hash; lo cambiado versiona, lo viejo `is_current=false` (no se borra).

---

## 10. `patient_embeddings` desde el MVP

Qué se embeddiza: los **chunks de transcripción** de cada consulta (y, opcionalmente, notas/mensajes), por clínica. Es lo que el esqueleto llamaba `transcript_chunks` + `search_transcripts`.

Para qué: el **contexto del paciente** ahora tiene dos partes → (a) consultas estructuradas (ficha, alergias, medicación) y (b) **búsqueda semántica sobre su propio historial** (`patient_embeddings`, filtrada por `clinic_id` + `patient_id`). Útil para "qué pasó en consultas previas".

Reglas: mismo modelo de embeddings que el corpus (registrado); costo bajo (una vez por chunk); **nunca** se mezcla con el corpus global (espacios y caminos separados); `clinic_id` explícito porque el microservicio puede usar `service_role`.

---

## 11. La cascada de retrieval (dos entradas, una cascada)

Se marca qué es determinístico (gratis) y dónde entra el LLM.

**0. Armar la consulta (A→B)** · *determinístico + LLM liviano de respaldo.* Palabra del vet (Athos) o hallazgos del transcript (Fantasma) → `glossary_synonym` → conceptos canónicos (+ `mesh` + relacionados) → consulta `{conceptos, mesh, especie (de la ficha), categoría, idioma}`. Si la detección queda pobre, un LLM liviano distila. Se loguea (`rag_retrieval_log`).

**1. Filtros determinísticos (Tier 0)** · *gratis.* Especie como **preferencia, no exclusión** (etiquetas ruidosas, 63% "mixto"; se apoya en MeSH `Cats`/`Dogs`), + boosts por idioma, `is_current`, `tier`, categoría, recencia.

**2. Léxico + glosario (Tier 1)** · *gratis, sin tokens.* Match de conceptos contra `glossary_terms`/`mesh` del chunk (preciso) + full-text de los términos canónicos EN contra `content` (cubre el ~90% sin MeSH). Fusión + boosts → candidatos.

**3. Vector de respaldo (Tier 2)** · *condicional, costo mínimo.* Solo si Tier 1 es débil: embeddiza la consulta y busca sobre el conjunto filtrado. Se loguea cuándo se dispara (huecos del glosario).

**4. Umbral** · *determinístico.* Si no pasa: en Athos → plantilla "no hay evidencia suficiente" **sin LLM**; en Fantasma → la nota SOAP igual se redacta del transcript, **sin literatura**.

**5. Fusión de contexto (en memoria, separada)** · *determinístico.* Literatura global (top-k acotado) + contexto del paciente (estructurado + `patient_embeddings`, RLS por `clinic_id`). **Nunca JOIN entre zonas.**

**6. Gate de alergia severa** · *determinístico, antes de cualquier plan* (sección 13).

**7. Generación (B→A)** · *la única IA de verdad.* En Fantasma, **una sola llamada** devuelve `summary` + SOAP + `allergy_flag` + `allergy_detail` (el `summarize.ts` actual). Lenguaje de posibilidad, citas mapeadas, presupuesto acotado, andamiaje determinístico.

**8. Verificación de citas (post-generación)** · *determinístico.* Toda afirmación clínica mapea a un chunk recuperado; lo que no, se descarta/marca. El modelo no puede inventar fuentes.

**9. Trazabilidad + humano.** `rag_retrieval_log` + `rag_answer_log` + `athos_messages`. El vet revisa, edita y aprueba; en Fantasma la nota va `draft → aprobado` (con el estado de `clinical_notes`).

---

## 12. Qué hace la IA y qué no

| Capa | Responsable | Qué |
|---|---|---|
| Código determinístico | Microservicio | Resolver paciente/`clinic_id`, filtros, gate de alergia, umbral, versionado, logs, verificación de citas, estados de la nota |
| Léxico + glosario | Postgres FTS + glosario | Recuperación principal, sin tokens |
| Vector | `pgvector` | Respaldo cuando el léxico es débil; historial del paciente |
| LLM (por definir) | — | (A→B) distilar consulta si el glosario no basta; (B→A) redactar respuesta citada |
| El LLM **nunca solo** | — | Decidir qué documentos traer; inventar fuentes; diagnóstico definitivo; plan sin gate de alergia; dosis sin datos; guardar sin aprobación; cruzar clínicas |

---

## 13. Hardening clínico y legal

**Dos capas de alergia, complementarias:**
- **Gate duro (determinístico, no negociable):** de `allergies` con `severity='severe'` — la alergia **conocida** del paciente. Bloqueante, se muestra **antes** de cualquier plan/dosis/dieta. Se registra en `clinical_notes.allergy_gate_triggered`. Nunca depende del LLM.
- **Flag del transcript (red adicional):** el `allergy_flag`/`allergy_detail` de `summarize.ts` capta una alergia **mencionada** en la consulta que aún no esté en la ficha, para que el vet la revise. No reemplaza al gate duro.

Otros: cita o se calla + verificación de citas · lenguaje de posibilidad · especie como preferencia · **sin dosis sin datos completos** (especie/peso/edad) · sin plan si falta info crítica · escalación al vet · trazabilidad completa · aislamiento por clínica (RLS + tests que fallan a propósito + `clinic_id` explícito con `service_role`) · licencia del corpus cerrada · secretos fuera de git.

---

## 14. Golden set (robusto) + evaluación

Instrumento con el que se **calibra el umbral** y se mide el **hit rate clínico**. Construido con veterinario(s), versionado, corrido en CI, y en crecimiento. Cada caso lleva: entrada (pregunta o transcript), especie, respuesta esperada, fuente esperada, y comportamiento esperado (responder / abstenerse / advertir / negarse).

**Composición objetivo (~1.100+ casos, ampliable):**

| Bloque | Casos | Qué prueba |
|---|---|---|
| Cobertura clínica normal (responde con cita) | ~400 | 8 especies × categorías clínicas del corpus |
| Sin evidencia (debe abstenerse) | ~120 | El umbral calla en vez de inventar |
| Documentos contradictorios | ~60 | Marca el conflicto, no elige en silencio |
| Documentos viejos vs vigentes | ~50 | Prefiere el vigente / declara antigüedad |
| Alergias severas (gate antes del plan) | ~100 | Caso Luna + variantes; gate determinístico |
| Interacciones de fármacos | ~60 | Detecta y advierte |
| Dosis sin datos completos (debe negarse) | ~50 | No dosifica sin especie/peso/edad |
| Fuera de alcance / debe negarse | ~60 | Reconoce límites |
| Especie incorrecta | ~40 | No trae literatura de otra especie |
| Lenguaje coloquial del dueño | ~80 | Estresa el puente del glosario |
| Puente ES→EN específico | ~60 | Consulta ES → documento EN |
| Adversariales | ~60 | Jailbreak a diagnóstico cerrado; inyección en el transcript |

Cada bloque se **cruza por entrada** (Athos vs Fantasma) y **por registro** (técnico vs coloquial). Crece siguiendo la frecuencia real de consultas.

**Métricas:** *retrieval* (recall@k, precision@k, filtrado de irrelevantes) · *generación* (0 diagnósticos cerrados, 0 alucinación, cobertura) · *citación* (% de afirmaciones con cita válida, 0 inventadas, precisión del `locator`) · *seguridad* (100% de detección de alergia severa conocida, 0 planes sin gate, tasa correcta de abstención) · *operación* (tasa de respaldo a vector = huecos del glosario; hit rate clínico = aptitud del corpus; latencia y costo por interacción).

**Umbral:** no se fija a ojo. Score combinado (conceptos por tier/evidencia + recencia + especie); arranca **conservador**; el número sale del desempeño en el golden set. Umbral mínimo para beta (a calibrar): citación válida ≥ ~90%, 0 diagnósticos definitivos, 0 fallos del gate duro de alergia, 0 citas inventadas, comportamiento correcto en todos los "debe negarse".

---

## 15. Trazabilidad y retención

Toda respuesta es rastreable a sus fuentes vía `rag_retrieval_log` (qué se recuperó) + `rag_answer_log` (respuesta + citas) + `athos_messages` (chat). **Se conserva con la historia clínica (permanente).** El audio crudo sigue con retención corta (7 días, `expires_at`); el transcript y la nota aprobada quedan.

---

## 16. Buenas prácticas de desarrollo

- **Determinístico primero, IA al final** → el retrieval completo es testeable con fixtures, **sin LLM**, en CI.
- **Ingesta idempotente por hash** → reprocesos seguros, versionado limpio.
- **IA agnóstica** → modelos y dimensión parametrizables (variable de entorno, como ya hace el esqueleto), registrados en metadata.
- **Global / por-clínica forzado en el esquema y en CI** → corpus/glosario sin `clinic_id`; paciente/personalización con `clinic_id` + RLS; **tests cross-tenant que fallan a propósito** (regla: PR con tabla nueva por-clínica sin RLS + test no pasa; PR que agregue `clinic_id` al corpus tampoco).
- **Disciplina de `service_role`** → `clinic_id` explícito + test.
- **Gates de seguridad en código, no en prompts.**
- **Citas con `locator`** · **disciplina `candidate → approved`** en el glosario · **observabilidad desde el día 1** (las métricas de la sección 14).

---

## 17. Tabla final de decisiones (todas cerradas)

| # | Decisión | Resolución |
|---|---|---|
| 1 | Tenancy | **Compartido + `clinic_id` + RLS** (no schema-por-tenant); phantom converge a tablas existentes |
| 2 | Motor de recuperación | **Léxico + glosario; vector de respaldo** |
| 3 | Sugerencia de Fantasma | **Solo si pasa el umbral** |
| 4 | Armado de consulta (A→B) | **Glosario primero, LLM liviano de respaldo** |
| 5 | Entrega del proveedor | **Texto + metadata; troceamos/embeddizamos/etiquetamos** |
| 6 | Nota + sugerencia (Fantasma) | **Una sola llamada combinada** (`summarize.ts`) |
| 7 | Idioma | **Indexación por idioma + glosario puente ES→EN**; PDFs/otros idiomas soportados por diseño |
| 8 | Glosario | **MeSH/DeCS + aumento veterinario**; normalizado; dueño = plataforma; `candidate→approved` |
| 9 | Alcance inicial glosario | **Sembrado amplio + curación prioritaria de lo común/riesgoso** |
| 10 | Composición del corpus | **Aceptar tal cual + ranking clínico + umbral**; medir hit rate |
| 11 | Aislamiento | **Corpus/glosario globales; paciente/personalización por clínica con RLS** |
| 12 | `patient_embeddings` | **Usado desde el MVP** (historial del paciente); mismo modelo que el corpus |
| 13 | Vector store | **`pgvector` en la misma BD** |
| 14 | Motores de IA | **Por definir, parametrizables, registrados** (dimensión parametrizable) |
| 15 | Chat + citas | **Tablas dedicadas** (`athos_messages` + `rag_retrieval_log` + `rag_answer_log`, RLS) |
| 16 | Retención de trazabilidad | **Con la historia clínica (permanente)** |
| 17 | Gate de alergia | **Determinístico duro** (`allergies.severity`) + flag del transcript como red adicional |
| 18 | Golden set | **Robusto (~1.100+ casos)**, con un vet, en CI, en crecimiento |
| 19 | Umbral numérico | **Calibrado con el golden set**; arranca conservador |
| 20 | Personalización por clínica (clase 4) | **Futuro, fuera de MVP** (infra vectorial por clínica ya lista) |

---

## 18. Plan de implementación por fases

**Fase 0 — Cimientos (existen):** tablas de paciente + multitenancy + RLS. Confirmar la frontera global/por-clínica y los tests cross-tenant en CI.

**Fase 1 — Corpus buscable:** columna `tsvector` + índices (GIN, HNSW) + estructura de `metadata` en `corpus_chunks`; RLS global; pipeline de ingesta; ingerir los 61.544.

**Fase 2 — Glosario:** crear `glossary_term/synonym/relation`; sembrar de MeSH/DeCS + `mesh` del corpus (candidate); curar la capa veterinaria/coloquial de lo común (approved); etiquetar chunks.

**Fase 3 — Cascada (determinística):** A→B, Tier 0/1/2, umbral, fusión de contexto, gate de alergia. **Testeable sin LLM** (fixtures + CI).

**Fase 4 — Generación + phantom + hardening:** integrar `summarize.ts` (parametrizado) sobre `clinical_notes`; verificación de citas; SSE (Athos); `patient_embeddings` (historial); tablas de trazabilidad.

**Fase 5 — Evaluación y operación:** golden set robusto; calibrar el umbral; observabilidad (respaldo a vector, hit rate clínico, latencia/costo); decidir con datos si el corpus necesita más material clínico.

---

## 19. Lo que queda pendiente de calibración (no son decisiones)

- **El número del umbral** y los umbrales de "pasar a beta" → salen del desempeño en el golden set.
- **La composición del corpus** → se monitorea con el hit rate clínico; si es bajo, se pide al proveedor más material clínico (guías/consensos/revisiones). No bloquea el MVP.

---

### Cierre

Una base de datos (Postgres), dos zonas que nunca se cruzan (global compartido vs por clínica con RLS), un buscador determinístico con un diccionario médico que hace casi todo sin gastar IA, la IA solo para entender y redactar, y si no hay evidencia, Athos se calla. El veterinario siempre revisa y aprueba. Todas las decisiones están cerradas; esto es lo que se construye.

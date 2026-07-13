# Athos (RAG) — Runbook completo: de cero a producción conectada

> Guía general y paso a paso: desde arrancar Claude Code hasta tener el microservicio **funcionando, en GitHub, desplegado en Railway y conectado** al Phantom y al frontend. Escrita sin dar nada por sentado: cada paso dice qué escribir, qué deberías ver y qué hacer si falla. **Sin Docker.** Base de datos en **Supabase** (nube).

## El viaje completo (mapa)
```
1 Instalar herramientas → 2 Arrancar Claude Code + entorno aislado → 3 Base de datos (Supabase)
→ 4 Variables de entorno → 5 "Hola mundo" (health) → 6 Construir el RAG con Claude Code
→ 7 Indexar los 61.544 documentos → 8 Subir a GitHub → 9 Pruebas automáticas (CI)
→ 10 Desplegar en Railway → 11 Conectar (Supabase compartida + Phantom + Frontend) → 12 Operar
```

## Decisiones ya cerradas (no hay que volver a discutirlas)
- **Tenancy:** compartido + `clinic_id` + RLS (no schema-por-tenant).
- **Recuperación:** cascada léxico + glosario; vector solo de respaldo. IA solo para entender (A→B) y redactar (B→A).
- **LLM redacción:** `claude-sonnet-5` (validar `claude-opus-4-8` en el golden set para casos difíciles). **LLM liviano:** `claude-haiku-4-5`. Siempre por variable de entorno.
- **Embeddings:** **Cohere embed-v4** (multilingüe con recuperación cross-lingual ES→EN); dimensión = 1024, misma en corpus y `patient_embeddings`. Bonus: **Cohere Rerank** es el candidato para el paso de reranking.
- **Modo Fantasma:** el Phantom llama a `POST /athos/phantom/suggest` al cerrar; **Athos escribe la nota `draft`** y devuelve el `note_id`.
- **Trazabilidad:** `athos_messages` + `rag_retrieval_log` + `rag_answer_log`, permanente con la historia.
- **`patient_embeddings`:** se usa desde el MVP.

## Glosario de 30 segundos
- **Terminal:** ventana de comandos (Mac: "Terminal"; Windows: "PowerShell").
- **`.venv`:** caja de Python aislada por proyecto (la crea `uv`) → no se mezcla con tus otros proyectos.
- **Migración:** archivo SQL que crea/cambia tablas; se guarda en el repo y se aplica a Supabase.
- **Railway:** donde vive el microservicio en producción.
Copia los comandos **una línea a la vez**, Enter, y espera a que termine.

---

## 1 · Instalar herramientas (una por una, verificando)
Tras cada instalación, **cierra la terminal y ábrela de nuevo**, y verifica.

**1.1 `uv`** (Python + librerías, aislado):
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh          # Mac/Linux
# Windows PowerShell:  irm https://astral.sh/uv/install.ps1 | iex
```
Verifica: `uv --version` → debe mostrar `uv 0.x.x`.

**1.2 Node 22** (para la CLI de Supabase y los conectores de Claude Code):
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
```
Reabre la terminal, luego: `nvm install 22 && nvm use 22 && node --version` → `v22.x`.
(Windows: si `nvm` no está, instala Node 22 LTS desde https://nodejs.org.)

**1.3 Claude Code:**
```bash
curl -fsSL https://claude.ai/install.sh | bash           # Mac/Linux
# Windows PowerShell:  irm https://claude.ai/install.ps1 | iex
```
Verifica: `claude --version` y `claude doctor` (chequeos en verde). Necesita plan pago de Claude (Pro/Max/Team/Enterprise) o API key.
*Error común:* "command not found" = no reabriste la terminal. Ciérrala y ábrela.

**1.4 Git:** `git --version`. Si falta: https://git-scm.com/downloads.

**1.5 CLI de Supabase (opcional):** `brew install supabase/tap/supabase` (o usa `npx supabase <cmd>`). Si no la tienes, aplicarás el esquema **haciendo clic** (paso 3.3).

---

## 2 · Arrancar Claude Code y crear el proyecto aislado

**2.1 Crear la carpeta:**
```bash
mkdir athos-service && cd athos-service
git init
```

**2.2 Crear el entorno aislado y las librerías:**
```bash
uv init .
uv venv                                                   # crea la caja .venv (clave del aislamiento)
uv add fastapi "uvicorn[standard]" pydantic pydantic-settings python-dotenv psycopg[binary] pgvector llama-index httpx pyjwt
uv add --dev pytest ruff
```
Deberías ver `Resolved ... packages`.

**2.3 Arrancar Claude Code dentro del proyecto:**
```bash
claude
```
La primera vez abre el navegador para iniciar sesión. Ya dentro, escribe:
- `/terminal-setup` (habilita Shift+Enter para varias líneas)
- `/model` (elige el modelo de trabajo de Claude Code)
- `/context` (ver cuánto espacio de conversación llevas) · `/clear` (limpiar entre tareas)

**2.4 Poner el `CLAUDE.md`:** copia el archivo `CLAUDE.md` (te lo entrego aparte) a la raíz de `athos-service`. Claude Code lo lee solo en cada sesión — ahí están todas las reglas para que construya lo correcto.

**2.5 Conectar Claude Code a tu DB y GitHub** (en una terminal normal, no dentro de Claude Code):
```bash
claude mcp add supabase -- npx -y @supabase/mcp-server-supabase@latest --read-only --project-ref TU_PROJECT_REF
claude mcp add github -- npx -y @modelcontextprotocol/server-github
claude mcp list
```
Arranca Supabase en **solo lectura**; quita `--read-only` solo cuando confíes en el flujo. `TU_PROJECT_REF` sale de la URL del panel de Supabase.

---

## 3 · Base de datos en Supabase (sin Docker)

> **Metodología de entornos y migraciones (cerrada).** Se desarrolla en un proyecto de dev
> **separado** (`tuvetia-athos-dev`), **nunca** contra el principal/compartido (ref
> `auxlnexhkmtoedrzfsnz`). Las migraciones (`supabase/migrations/`) son la **única fuente de
> verdad** y fluyen **dev → PR → principal** con el **CLI de Supabase** (`supabase db push`),
> aplicando los **mismos archivos** — sin copiar bases ni recrear tablas generales. El esquema
> base del principal se replica en dev **solo** vía `supabase/bootstrap/`. Runbook completo:
> **`docs/MIGRACIONES.md`**.

**3.1 Crear un proyecto de DEV** (para no tocar la base compartida):
1. https://supabase.com → login → **"New project"** → nómbralo `tuvetia-athos-dev`.
2. Elige y **guarda** la contraseña de la base.
3. Espera 1–2 min a que quede listo.

**3.2 Bootstrapear el esquema base en dev:** las tablas base (`corpus_chunks`, `patients`, `clinical_notes`…) ya existen en el proyecto principal, pero un proyecto de dev **separado no las hereda**. Pide a Santiago/Pipe el **script/volcado del esquema base**, guárdalo en `supabase/bootstrap/000_base_schema.sql` y aplícalo **solo en dev** (SQL Editor o `psql`). **No** va en `supabase/migrations/` ni se PR-ea al principal (ya lo tiene). (Si algún día se habilita **Branching** en el plan, una rama traería el esquema automáticamente y sustituiría este paso.)

**3.3 Aplicar el esquema del RAG (CLI recomendado):** el SQL de abajo ya vive versionado en `supabase/migrations/0001_rag_corpus_glossary_trace.sql`.
- **Vía recomendada (CLI, contra dev):** `supabase link --project-ref <DEV_REF>` y luego `supabase db push`.
- **Alternativa manual (clic):**
  1. Panel del proyecto **dev** → **"SQL Editor"** → **"New query"**.
  2. Pega el SQL de abajo → **"Run"**. Deberías ver `Success. No rows returned`.
  3. Verifica en **"Table Editor"**: aparecen `glossary_term`, `glossary_synonym`, `glossary_relation`, `athos_messages`, `rag_retrieval_log`, `rag_answer_log`.
- El archivo `0001_...sql` es la **fuente de verdad**; toda nueva migración se crea con `supabase migration new` y se aplica con `supabase db push` (ver `docs/MIGRACIONES.md`).

```sql
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
```

**3.4 Copiar llaves:** Panel → **Project Settings → API** (Project URL, anon key, service_role key) y **→ Database** (Connection string). La **service_role key es secreta**: solo servidor, nunca Git ni frontend.

---

## 4 · Variables de entorno (`.env`)
Crea `.env` en `athos-service` y reemplaza los `...`:
```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...            # SECRETA. Solo servidor.
SUPABASE_JWT_SECRET=...                  # de Project Settings → API → JWT Settings (para verificar tokens del front)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres

LLM_MODEL=claude-sonnet-5
LLM_LIGHT_MODEL=claude-haiku-4-5
LLM_API_KEY=...                          # console.anthropic.com
EMBEDDING_PROVIDER=cohere
EMBEDDING_MODEL=embed-v4.0                # Cohere (verifica el ID exacto en docs de Cohere)
EMBEDDING_DIM=1024                       # DEBE coincidir con la DB (Cohere soporta 1024)
EMBEDDING_API_KEY=...                     # de dashboard.cohere.com

CORS_ORIGINS=http://localhost:3000       # + el dominio del frontend cuando exista
APP_ENV=dev
```
Crea `.gitignore`:
```bash
printf ".env\n.venv/\n__pycache__/\nsupabase/.temp/\nrequirements.txt\n" > .gitignore
```

---

## 5 · "Hola mundo" (verificar que arranca)
Crea `app/main.py`:
```python
from fastapi import FastAPI
app = FastAPI(title="Athos RAG service")

@app.get("/health")
def health():
    return {"status": "ok", "service": "athos"}
```
Arranca y prueba (en otra terminal):
```bash
uv run uvicorn app.main:app --reload --port 8000
curl http://localhost:8000/health        # {"status":"ok","service":"athos"}
```
Si responde eso, el entorno está montado. `Ctrl + C` para detener.

---

## 6 · Construir el RAG con Claude Code (vibe coding, en orden)
Dale a Claude Code **una tarea a la vez**, apuntando a la sección del documento final. Después de cada una: revisa el diff, corre `uv run pytest` y `uv run ruff check`, y commitea. Prompts sugeridos:

1. **Estructura:** "Crea la estructura `app/{config,db,ingestion,glossary,retrieval,generation,trace}` con las firmas de funciones de la cascada según la sección 11 del documento final. `config.py` lee todo de variables de entorno."
2. **Ingesta:** "Implementa el pipeline de ingesta (sección 9): idempotente por `content_hash`, frontmatter→`metadata`, chunking con `locator` sin partir tablas/dosis, embedding por `EMBEDDING_MODEL`, `tsvector` según el `idioma` del documento, etiquetado con glosario. Tests con 2–3 documentos de ejemplo."
3. **Glosario:** "Implementa la siembra del glosario desde los términos MeSH del corpus + DeCS, con estado `candidate→approved` (sección 8), y la resolución de una consulta ES → conceptos canónicos."
4. **Cascada (sin IA):** "Implementa Tier 0/1/2, umbral y fusión de contexto (secciones 11.1–11.5) como funciones puras determinísticas. Tests **sin LLM** con fixtures, corribles en CI."
5. **Gate + generación:** "Implementa el gate de alergia (11.6, determinístico desde `allergies`), la generación B→A (11.7, una sola llamada para Fantasma, modelo por `LLM_MODEL`) y la verificación de citas (11.8)."
6. **Endpoints:** "Implementa `POST /athos/chat` (SSE), `POST /athos/phantom/suggest` (contrato de la sección de integración: crea `clinical_notes` draft y devuelve el payload), `POST /ingest`, `GET /health`. Verifica el JWT de Supabase (`SUPABASE_JWT_SECRET`), resuelve `clinic_id` desde `memberships`, habilita CORS con `CORS_ORIGINS`."
7. **Tests cross-tenant:** "Seed 2 clínicas; verifica que un usuario de B no puede leer/escribir filas de A en `athos_messages`, `rag_retrieval_log`, `rag_answer_log`, `patient_embeddings`."

Regla de oro: una tarea, revisa, prueba, commitea, `/clear`.

---

## 7 · Indexar los 61.544 documentos
1. Coloca el corpus (el zip descomprimido) en una carpeta, p. ej. `data/corpus/`.
2. Pídele a Claude Code un script/endpoint que recorra `data/corpus/`, lea cada `.md`, y ejecute el pipeline del paso 6.2 escribiendo en `corpus_chunks`.
3. Corre primero con **un subconjunto** (p. ej. 100 documentos) para validar, luego el total:
   ```bash
   uv run python -m app.ingestion.run --path data/corpus --limit 100
   uv run python -m app.ingestion.run --path data/corpus
   ```
4. Verifica en Supabase Table Editor que `corpus_chunks` tiene filas con `embedding`, `tsv` y `metadata` pobladas.
> Es idempotente por `content_hash`: puedes re-correrlo sin duplicar.

---

## 8 · Subir a GitHub
1. Crea el repositorio en https://github.com (botón **New**), por ejemplo `tuvetia-athos`. **No** agregues README/gitignore desde la web (ya los tienes).
2. En tu terminal, en `athos-service`:
   ```bash
   git add -A
   git commit -m "Athos: base del servicio + esquema RAG + ingesta"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/tuvetia-athos.git
   git push -u origin main
   ```
   Deberías ver el código en GitHub. **Confirma que `.env` NO aparece** (debe estar ignorado).
3. **Flujo de trabajo con el equipo:** trabaja en ramas y abre PR:
   ```bash
   git checkout -b feature/ingesta
   # ...cambios + commits...
   git push -u origin feature/ingesta
   ```
   Abre el Pull Request en GitHub para que revisen antes de mezclar a `main`.

---

## 9 · Pruebas automáticas (CI en cada PR)
Crea `.github/workflows/ci.yml` (pídeselo a Claude Code):
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv sync
      - run: uv run ruff check
      - run: uv run pytest
```
Commit y push. En GitHub, pestaña **Actions**, verás las pruebas correr en cada PR. **Regla:** un PR que agrega una tabla por-clínica sin RLS + sin test cross-tenant no se mezcla.

---

## 10 · Desplegar en Railway
1. Prepara el arranque para producción:
   ```bash
   uv export --no-hashes -o requirements.txt         # Railway instala desde aquí
   printf "web: uvicorn app.main:app --host 0.0.0.0 --port \$PORT\n" > Procfile
   git add requirements.txt Procfile && git commit -m "deploy: requirements + Procfile" && git push
   ```
2. En https://railway.app → login → **New Project** → **Deploy from GitHub repo** → elige `tuvetia-athos`.
3. Railway detecta Python y construye. Ve a **Variables** y agrega **todas** las del `.env` (usa la Supabase compartida/staging y tus llaves de IA; **nunca** subas `.env` al repo).
4. En **Settings → Networking**, genera un dominio público. Copia la URL (algo como `https://tuvetia-athos-production.up.railway.app`).
5. Verifica en producción:
   ```bash
   curl https://TU-URL.up.railway.app/health     # {"status":"ok","service":"athos"}
   ```
6. Cada `git push` a `main` vuelve a desplegar automáticamente.

---

## 11 · Conectar con las demás partes

**11.1 Supabase compartida (dev → PR → principal).** Cuando el RAG esté probado en dev, abre un **PR** con los archivos de `supabase/migrations/` y, tras la revisión de Santiago/Pipe, aplica **las mismas** migraciones al principal con el CLI (`supabase link --project-ref <MAIN_REF> && supabase db push`, con las credenciales del principal como **secretos**) — **nunca** copiando bases a mano ni recreando tablas generales. Detalle en `docs/MIGRACIONES.md`. En Railway, apunta `SUPABASE_*`/`DATABASE_URL` a la base compartida/staging.

**11.2 Phantom (Pipe).** Ya está el contrato: cuando el vet cierra la consulta, el código de Pipe hace `POST https://TU-URL/athos/phantom/suggest` con `{ consultation_id, clinic_id }` y el JWT del usuario. Athos genera, escribe la nota `draft` en `clinical_notes`, y devuelve `{ note_id, soap, allergy_gate_triggered, allergy_transcript_flag, insufficient_evidence, citations, ai_model }`. Pásale a Pipe tu URL y este contrato.

**11.3 Frontend (Santiago).** El front llama a Athos con el **JWT de Supabase del usuario** en `Authorization: Bearer <token>`:
- Athos **verifica** ese JWT con `SUPABASE_JWT_SECRET`, saca el `user_id` y resuelve `clinic_id` desde `memberships`.
- Habilita **CORS** para el dominio del front (agrega el dominio de Vercel a `CORS_ORIGINS`).
- El chat usa **SSE**: el front abre la conexión a `POST /athos/chat` y va mostrando la respuesta en streaming, con sus citas.
- Pásale a Santiago tu URL, los endpoints y el formato de respuesta.

---

## 12 · Operar (después del lanzamiento)
- **Golden set robusto** (~1.100+ casos) para calibrar el umbral y medir calidad.
- **Observabilidad** desde el día 1: tasa de respaldo a vector (huecos del glosario), hit rate clínico (aptitud del corpus), latencia y costo por interacción.
- Con esos datos decides si el corpus necesita más material clínico y si escalas a Opus 4.8 en casos difíciles.

---

## Checklist maestro
- [ ] `uv`, Node 22, Claude Code, Git instalados y verificados.
- [ ] `athos-service` con `.venv` (entorno aislado) · `CLAUDE.md` en la raíz · MCP de Supabase (read-only) + GitHub.
- [ ] Proyecto Supabase de dev + esquema base + migración del RAG aplicada.
- [ ] `.env` completo · `.gitignore` protege secretos · `GET /health` responde.
- [ ] RAG construido con Claude Code (ingesta, glosario, cascada, generación, endpoints) · tests sin LLM + cross-tenant en verde.
- [ ] 61.544 documentos indexados en `corpus_chunks`.
- [ ] Repo en GitHub · CI corriendo en PRs · `.env` NO subido.
- [ ] Desplegado en Railway · `/health` responde en la URL pública.
- [ ] Conectado: migraciones coordinadas en la base compartida · contrato con Pipe · URL + endpoints + CORS para el frontend.

Con esto el microservicio queda construido, probado, desplegado y conectado — listo para producción.

# Migraciones y entornos — runbook

> Cómo se desarrolla el esquema de Athos **sin tocar el proyecto principal**, y cómo se integran
> los cambios de forma segura. Metodología **cerrada** (ver también `../CLAUDE.md`).

## Principio (léelo una vez y no lo olvides)
- **Proyecto principal** (compartido / producción): ref `auxlnexhkmtoedrzfsnz`. **NUNCA** se
  desarrolla ni se escribe directamente contra él desde una máquina de dev (MCP incluido).
- **Proyecto de desarrollo:** `tuvetia-athos-dev` (Supabase **separado**). Aquí se prueba todo.
- **`supabase/migrations/*.sql` = única fuente de verdad** de *nuestros* cambios de esquema
  (tablas del RAG: `glossary_*`, `athos_messages`, `rag_retrieval_log`, `rag_answer_log`, e
  índices/ALTERs sobre las tablas base). Fluyen **dev → PR → principal**, aplicando **los mismos
  archivos**. Nada de copiar bases ni recrear tablas generales.
- **`supabase/bootstrap/`** = esquema base (de Santiago/Pipe) para arrancar **solo** el proyecto
  dev. **No** se PR-ea al principal (ya lo tiene). Ver `../supabase/bootstrap/README.md`.

> **Sin Docker:** no usamos el stack local (`supabase start`). Trabajamos con `supabase link` +
> `supabase db push` **contra el proyecto dev remoto**. Por eso las migraciones se **escriben a
> mano** (como `0001`) o con `supabase migration new`; `supabase db diff` no se usa (requiere Docker).

## Setup inicial del entorno dev (una sola vez)
1. **Crear** el proyecto `tuvetia-athos-dev` en supabase.com. Guardar `project_ref`, la
   **DB password** y las keys (API + JWT).
2. **Bootstrapear el esquema base** en dev (una vez que tengas `supabase/bootstrap/000_base_schema.sql`):
   - SQL Editor: pega el contenido y **Run**, **o**
   - `psql "<DATABASE_URL_DEV>" -f supabase/bootstrap/000_base_schema.sql`
3. **Link** del CLI al proyecto dev (pide la DB password de dev):
   ```
   supabase link --project-ref <DEV_REF>
   ```
4. **Aplicar nuestras migraciones del RAG** a dev:
   ```
   supabase db push
   ```
5. **Rellenar `.env`** con las credenciales de **dev** (`SUPABASE_URL`, keys, `SUPABASE_JWT_SECRET`,
   `DATABASE_URL` → todos apuntando a dev).
6. **(Seguridad)** Repuntar `.mcp.json` al ref de **dev** y recién ahí autenticar el MCP
   (`/mcp` → supabase → *Authenticate*). El principal nunca queda escribible por MCP.

## Crear una nueva migración
```
supabase migration new <nombre>        # crea supabase/migrations/<timestamp>_<nombre>.sql
# edita el SQL a mano
supabase db push                       # la aplica al proyecto dev enlazado
# verifica en dev, luego commitea el .sql
```

## Integrar al proyecto principal (dev → PR → principal)
1. **PR** que incluye únicamente los **nuevos** archivos de `supabase/migrations/`. Revisión de
   Santiago/Pipe.
2. Al aprobar, aplicar **las mismas** migraciones al principal:
   - Recomendado (CI o coordinado): `supabase link --project-ref <MAIN_REF> && supabase db push`,
     con las credenciales del principal como **secretos** (nunca en el repo), **o**
   - vía la integración de GitHub de Supabase si el equipo la usa.
3. **Regla de merge:** un PR que agrega una tabla **por-clínica** sin **RLS** + sin **test
   cross-tenant** NO se mergea.

## Reglas duras
- Nunca `supabase db push` ni escritura directa contra el **principal** desde tu máquina de dev.
- Nunca metas el esquema **base** (bootstrap) en `supabase/migrations/` ni lo PR-ees.
- `.env` local = **dev**. Credenciales del **principal** solo en CI / secretos.
- MCP y cualquier herramienta con **escritura** → solo **dev**.

## ⚠️ Estado del entorno dev al 2026-07-30 (leer antes de correr tests)

**El proyecto dev `ghmpjyuchwkrvnjvdeum` fue borrado** (se usó para pruebas). Hasta que se recree,
NO hay un Supabase de desarrollo, y eso tiene tres consecuencias que ya se materializaron:

1. **Los `.mcp.json` quedaron en `read_only=true` contra el principal.** El de la raíz apuntaba al
   principal **con escritura** desde el 2026-07-15 (`c0a29b6`, anterior a este runbook): cualquier
   agente que corriera desde la raíz podía escribir en producción. El de `athos-service/` apuntaba
   al proyecto borrado. Ambos ahora son de solo lectura. **Cuando se recree dev, se repuntan a su
   ref — y sólo ahí puede habilitarse escritura.**
2. **Ningún `.env` debe apuntar al principal.** El 2026-07-30 los logs de producción registraron
   `invalid input syntax for type uuid: "clinic-a"` — el literal que usan `test_chat.py` y
   `test_phantom.py`: la suite corrió contra producción. No hubo daño (la consulta murió en el cast
   del UUID, sin leer ni escribir; verificado: cero filas de fixture en el principal), pero con un
   UUID válido habría corrido de verdad. `tests/conftest.py` ahora **aborta la suite** si
   `DATABASE_URL` contiene el ref del principal.
3. **Mientras tanto, para correr los tests de integración hay un Postgres local**, el mismo que usa
   el CI (`.github/workflows/ci.yml` → `services: postgres`):
   ```
   docker run -d --name pg-dev -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=athos_test \
     -p 55432:5432 pgvector/pgvector:pg16
   psql "postgresql://postgres:postgres@localhost:55432/athos_test" -v ON_ERROR_STOP=1 \
     -f ../.github/ci/athos-db-shim.sql          # auth.users, auth.uid(), roles RLS
   psql "...misma URL..." -f supabase/bootstrap/000_base_schema.sql
   for f in supabase/migrations/*.sql; do psql "...misma URL..." -v ON_ERROR_STOP=1 -f "$f"; done
   ```
   Es gratis, no necesita cuenta y la secuencia está verificada contra `pgvector:pg16`.

## Comandos útiles
```
supabase migration list      # estado: versiones locales vs aplicadas en el proyecto enlazado
supabase projects list       # tus proyectos (para ver refs)
supabase link --project-ref <REF>   # cambiar de proyecto enlazado (dev / principal)
```

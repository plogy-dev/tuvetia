# Migraciones y entornos — runbook

> Cómo se desarrolla el esquema de Athos **sin tocar el proyecto principal**, y cómo se integran
> los cambios de forma segura. Metodología **cerrada** (ver también `../CLAUDE.md`).

## Principio (léelo una vez y no lo olvides)
- **Proyecto principal** (compartido / producción): ref `auxlnexhkmtoedrzfsnz`. **NUNCA** se
  desarrolla ni se escribe directamente contra él desde una máquina de dev (MCP incluido).
- **Proyecto de desarrollo:** `tuvetia-athos-dev`, ref **`gdiiagioiukadifejewv`** (Supabase
  **separado**, us-west-2). Aquí se prueba todo. **Recreado el 2026-07-31**: el anterior
  (`ghmpjyuchwkrvnjvdeum`) se borró, y sin él la suite terminó corriendo contra producción.
  Reconstruirlo cuesta ~1 h porque el esquema es código: `supabase/bootstrap/000_base_schema.sql`
  y las migraciones de `supabase/migrations/`. La cadena de conexión no va al repo.
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

## Correr los tests de integración sin depender del proyecto de dev

El dev remoto es la referencia (ver arriba: `gdiiagioiukadifejewv`, recreado el 2026-07-31), pero
**no debe ser la única forma de correr las pruebas de aislamiento**. El 2026-07-30 el dev anterior
se borró, y con él esas pruebas quedaron sin dónde correr — que es cómo la suite terminó apuntando
a producción. Por eso hay un camino local, sin cuenta ni secretos, idéntico al que usa el CI cuando
`ATHOS_DEV_DATABASE_URL` no está configurado:

```
docker run -d --name pg-dev -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=athos_test \
  -p 55432:5432 pgvector/pgvector:pg16

psql "postgresql://postgres:postgres@localhost:55432/athos_test" -v ON_ERROR_STOP=1 \
  -f ../.github/ci/athos-db-shim.sql          # auth.users, auth.uid(), roles de RLS
psql "...misma URL..." -f supabase/bootstrap/000_base_schema.sql
for f in supabase/migrations/*.sql; do psql "...misma URL..." -v ON_ERROR_STOP=1 -f "$f"; done
```

El shim crea el mínimo de Supabase que el esquema asume (`auth.users`, `auth.uid()`, los roles
`anon`/`authenticated`/`service_role`) para que el SQL del repo aplique tal cual en un Postgres
pelado.

> **Esta secuencia estuvo ROTA entre el 2026-07-27 y el 2026-08-02, y conviene saber por qué.**
>
> La `0022` empieza con `alter table public.memberships …` sobre una tabla que **ningún archivo del
> repo creaba**: nació aplicada a mano al principal y nunca se escribió. Con `ON_ERROR_STOP=1` el
> bucle moría ahí, así que **las 32 migraciones siguientes nunca se ejecutaron desde cero** — y
> levantar un dev nuevo era imposible, aunque este documento dijera lo contrario.
>
> Lo cierra `0021b_objetos_que_nadie_crea.sql`, que crea los cuatro objetos huérfanos
> (`memberships`, el tipo `clinic_role`, y las RPC `create_owner`/`create_patient`) y es un no-op
> exacto sobre cualquier base donde ya existan.
>
> Si el bucle vuelve a morir en un `alter`/`revoke` sobre algo que no existe, es el mismo patrón:
> un objeto aplicado a mano que nunca entró al repo. La forma de detectarlos es cruzar los
> `alter table` / `drop policy` / `revoke on function` contra los `create` de `bootstrap/` +
> `migrations/`.

**El registro de migraciones NO describe el estado real, y no sirve para saber qué falta.** Medido
el 2026-08-02 contra el principal: `supabase_migrations.schema_migrations` tiene 56 filas contra 53
archivos — 10 archivos aplicados sin registrar, 13 filas sin archivo, y 11 números que significan
cosas distintas acá y allá (`"0022"` en el registro es `security_hardening`; en el repo es
`multi_clinic_memberships`). O sea que `supabase migration list` contra el principal miente en las
dos direcciones, y `db push` re-aplicaría 10 migraciones — entre ellas la del índice HNSW, que son
4 GB.

Lo único que dice la verdad es la introspección del catálogo:

```sql
-- tablas          → pg_class / pg_namespace
-- columnas        → information_schema.columns
-- funciones       → md5(regexp_replace(prosrc,'\s+','','g')) y comparar contra el archivo
-- índices         → pg_index / pg_class
-- policies        → pg_policy
-- realtime        → pg_publication_rel
```

**Cuál usar:** el dev remoto es más fiel (misma RLS y mismos tipos que producción) y es lo que el CI
prefiere si el secreto está puesto. El local sirve para iterar rápido y como red cuando el dev no
está disponible.

> **Contexto de por qué esto importa.** El 2026-07-30 los logs de producción registraron
> `invalid input syntax for type uuid: "clinic-a"` — el literal que usan `test_chat.py` y
> `test_phantom.py`: la suite corrió contra el principal. No hubo daño (la consulta murió en el cast
> del UUID, sin leer ni escribir; verificado: cero filas de fixture en el principal), pero con un
> UUID válido habría corrido de verdad. Hoy lo cortan dos guardas: `app/db.py` al abrir la conexión
> y `tests/conftest.py` al arrancar la suite.

## Comandos útiles
```
supabase migration list      # estado: versiones locales vs aplicadas en el proyecto enlazado
supabase projects list       # tus proyectos (para ver refs)
supabase link --project-ref <REF>   # cambiar de proyecto enlazado (dev / principal)
```

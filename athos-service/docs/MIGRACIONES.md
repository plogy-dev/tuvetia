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

**El nombre es `NNNN_nombre_en_snake_case.sql`, con el número consecutivo.** No se usa
`supabase migration new`: ese comando genera nombres con *timestamp* y este repo numera en
secuencia, porque el número **es** el orden de aplicación.

### 🔢 Reservá el número al abrir el PR, no al escribir el archivo

Es la regla que más se incumple, y ya costó **tres choques**: `0019`, `0020` y `0065`. El último fue
el 2026-08-17 — dos personas escribiendo en paralelo eligieron `0065` cada una, las dos migraciones
se aplicaron, y el repo quedó con dos archivos que dicen ser la misma posición.

Mirá el último número **en `master`**, no en tu rama. Si otro PR ya tomó el tuyo, renumerá antes de
mergear.

Hay una guarda que lo verifica: `src/lib/__tests__/numeracion-de-migraciones.test.ts` **falla en CI**
si aparece un número repetido nuevo. Los tres históricos están declarados ahí como excepción y no se
renombran — ya se aplicaron con ese nombre, y renombrarlos haría que el repo afirme algo que no pasó.

**Si necesitás intercalar** una migración entre dos que ya existen, el sufijo de letra es la vía:
`0021b_objetos_que_nadie_crea.sql` corre después de la `0021` y antes de la `0022`. Ordena bien
porque `_` (ASCII 95) va antes que `b` (98).

### El flujo

```
# 1. Mirá el último número EN MASTER y tomá el siguiente
# 2. Escribí athos-service/supabase/migrations/NNNN_nombre.sql a mano
# 3. Escribí su verificación en athos-service/supabase/verificaciones/NNNN_nombre.sql
supabase db push        # la aplica al proyecto DEV enlazado — nunca al principal
```

La **verificación** no es opcional desde la `0059`: es lo único que confirma que la migración hizo
lo que dice. Terminan con `raise exception '=== NNNN OK === …'`, así que **un error `P0001` con el
texto `OK` es el éxito** — el `raise` aborta el bloque y hace rollback de los datos de prueba.

## Integrar al proyecto principal (dev → PR → principal)

1. **PR** con los archivos nuevos de `supabase/migrations/` y su verificación. Revisión de
   Santiago/Pipe.
2. Al aprobar, **aplicar A MANO por el editor SQL del principal**: pegar la migración, ejecutar,
   y después correr su verificación.
3. **Regla de merge:** un PR que agrega una tabla **por-clínica** sin **RLS** + sin **test
   cross-tenant** NO se mergea.

> ⚠️ **`supabase db push` contra el principal: NO.** Esta sección lo recomendaba y era un error —
> contradecía además la primera de las Reglas duras de abajo.
>
> El principal lleva su propio historial en `supabase_migrations.schema_migrations`: **55 entradas
> del equipo original** con versiones tipo `20260727073858`, y **ninguna** con nuestra numeración
> `00XX`. Un `db push` no reconoce ese historial — intentaría reconciliar dos numeraciones distintas
> sobre una base con datos clínicos reales.
>
> Las migraciones `0059`–`0067` se aplicaron a mano, y así se siguen aplicando.

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

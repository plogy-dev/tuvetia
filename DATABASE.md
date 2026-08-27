# Base de datos

Este proyecto usa **Supabase** (Postgres) como base de datos, conectado a través de un servidor MCP dedicado al proyecto (no el conector genérico de la cuenta de claude.ai).

## Conexión

> **Verificado contra el repo el 2026-08-27.**

- **Project ref:** `auxlnexhkmtoedrzfsnz`
- **Servidor MCP:** `supabase` (scope: `project`). Hay **dos** `.mcp.json` y los dos declaran lo mismo: [`.mcp.json`](.mcp.json) en la raíz y [`athos-service/.mcp.json`](athos-service/.mcp.json).

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=auxlnexhkmtoedrzfsnz&read_only=true"
    }
  }
}
```

> 🔒 **`read_only=true` no es un detalle de configuración: es la corrección del incidente del 30-jul.**
> Ese día la suite terminó apuntando al principal y en los logs de producción aparecieron
> `invalid input syntax for type uuid: "clinic-a"` — los fixtures de las pruebas contra la base con
> datos clínicos reales. Desde entonces **el principal nunca queda escribible por MCP**, que es una
> de las reglas duras de [`athos-service/docs/MIGRACIONES.md`](athos-service/docs/MIGRACIONES.md).
>
> Ésta es la **configuración de referencia** del repo, la que está commiteada. Si en tu copia de
> trabajo ves `read_only=false`, es una modificación local: **no es lo que el repo declara** y no
> deberías subirla. Herramientas con escritura → sólo contra el proyecto **dev**
> (`gdiiagioiukadifejewv`), repuntando el `.mcp.json` a ese ref.

Al estar en `.mcp.json` (no en settings globales), este servidor viaja con el repo: cualquiera que clone el proyecto y use Claude Code lo verá disponible automáticamente, pero cada persona debe autenticarse por su cuenta (la sesión de auth no se comparte ni se versiona).

## Autenticación (pendiente)

El servidor MCP remoto requiere OAuth interactivo, que **no puede completarse desde una sesión no interactiva** (como esta del IDE). Para autenticar:

1. Abrir una terminal normal (no la del IDE) en la raíz del proyecto.
2. Ejecutar:
   ```
   claude
   ```
3. Dentro de la sesión, correr `/mcp`, seleccionar el servidor `supabase` y completar el flujo de autenticación (se abre el navegador).
4. Verificar el estado con:
   ```
   claude mcp list
   ```
   Debe pasar de `⏸ Pending approval` a `✔ Connected`.

Hasta que esto se complete, las herramientas del MCP de Supabase (consultas, introspección, diagnóstico) no están disponibles para este proyecto específico. Las **migraciones no dependen de esto**: se aplican a mano por el editor SQL, no por MCP (ver la sección siguiente).

## Cómo se opera la base de datos vía MCP

Una vez autenticado, Claude Code expone herramientas con el prefijo `mcp__supabase__*`. **Contra el principal el MCP es una herramienta de LECTURA, y nada más** — con `read_only=true` las de escritura ni siquiera están disponibles. Lo que sí sirve:

- `list_tables` / `list_extensions` / `list_migrations` — inspeccionar el esquema y los metadatos.
- `execute_sql` — **sólo consultas.** Es la vía para introspección del catálogo, que según `MIGRACIONES.md` es lo único que dice la verdad sobre el estado del principal (`supabase migration list` miente en las dos direcciones).
- `generate_typescript_types` — generar los tipos TS del esquema para el código de Next.js.
- `get_logs` / `get_advisors` — diagnóstico y recomendaciones de seguridad/performance.
- `get_project_url` / `get_publishable_keys` — la URL y la clave pública para configurar el cliente de Supabase en el frontend (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

### El MCP **no** es la vía para seeds, fixes ni migraciones

Este documento decía lo contrario y era falso en las dos puntas: ni `apply_migration` ni un `execute_sql` de escritura funcionan contra el principal en sólo-lectura, y aunque funcionaran, la regla de la casa los prohíbe. La vía real, según [`athos-service/docs/MIGRACIONES.md`](athos-service/docs/MIGRACIONES.md):

| Qué querés hacer | Cómo se hace de verdad |
|---|---|
| **Cambiar el esquema** (tabla, columna, índice, RLS) | Escribir `athos-service/supabase/migrations/NNNN_nombre.sql` **a mano** + su verificación en `supabase/verificaciones/NNNN_nombre.sql`. Reservá el número **al abrir el PR** mirando el último en `master`, no en tu rama. |
| **Probarlo** | `supabase db push` contra el proyecto **dev** enlazado (`gdiiagioiukadifejewv`), o el Postgres local con el shim de `.github/ci/athos-db-shim.sql`. |
| **Llevarlo al principal** | PR → revisión → **aplicar A MANO por el editor SQL del principal**, y después correr la verificación. |
| **Un seed o un fix de datos** | Igual: por el editor SQL del principal, a mano y con alguien mirando. Nunca desde una máquina de dev por MCP. |

> ⛔ **`supabase db push` contra el principal: NO.** El principal lleva su propio historial en `supabase_migrations.schema_migrations` (55 entradas del equipo original, con versiones tipo `20260727073858`, ninguna con nuestra numeración `00XX`). Un `db push` intentaría reconciliar dos numeraciones distintas sobre una base con datos clínicos reales, y re-aplicaría migraciones ya aplicadas — entre ellas la del índice HNSW, que son 4 GB.

**Regla dura, de `MIGRACIONES.md`:** *MCP y cualquier herramienta con escritura → sólo dev.* El principal se escribe a mano, por el editor SQL, y con la migración ya revisada en un PR.

## Autenticación

Login sin contraseña (magic link) + Google OAuth, usando `@supabase/ssr` (helpers en `src/lib/supabase/`: `client.ts`, `server.ts`, `middleware.ts`) y `src/proxy.ts` (en esta versión de Next.js el archivo `middleware.ts` se renombró a `proxy.ts` — ver `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`) para refrescar la sesión y proteger `/dashboard`.

**Flujo de alta (ya estaba modelado en el esquema, no lo inventamos):**

1. `public.handle_new_user()` — trigger `on_auth_user_created` en `auth.users` (AFTER INSERT) que crea una fila mínima en `public.profiles` (sin `clinic_id`, rol por defecto `vet`).
2. `public.create_clinic(clinic_name text)` — RPC `SECURITY DEFINER` que crea la clínica y actualiza el `profile` del usuario autenticado (`auth.uid()`) a `clinic_id` + `role = 'admin'`. La llama `ensureClinicForUser` (`src/lib/supabase/ensure-clinic.ts`) justo después de establecer sesión en `/auth/confirm` (magic link) y `/auth/callback` (Google OAuth), solo si el profile todavía no tiene `clinic_id`. El nombre de la clínica sale de `user_metadata.clinic_name` (capturado en el signup) o de un fallback si vino por Google.
3. `public.accept_invitation(invite_token text)` — RPC ya existente para que un usuario invitado (vía tabla `invitations`) quede asociado a una clínica existente con el rol de la invitación. Aún no hay UI que la use.

**Nota de RLS:** la policy `profiles_select` se amplió (`clinic_id = private.my_clinic_id() OR id = auth.uid()`) porque un usuario recién creado tiene `clinic_id IS NULL` y sin esa condición no podía ni leer su propia fila — bloqueaba el paso 2 del flujo de alta.

**Rutas:** `/` (login), `/signup` (registro), `/auth/confirm` (verifica el magic link), `/auth/callback` (intercambia el `code` de OAuth).

## Pacientes y Titulares

- `public.create_owner(p_full_name, p_phone, p_email, p_document_id, p_address, p_notes)` — RPC `SECURITY DEFINER`, crea un `owner` en la clínica del usuario autenticado (resuelve `clinic_id` vía `private.my_clinic_id()`, el cliente nunca lo manda). Ojo: si se vuelve a cambiar la firma de esta función, `create or replace` **no reemplaza** la versión anterior si cambian los parámetros — Postgres la trata como una sobrecarga nueva. Hay que `drop function` la firma vieja explícitamente (nos pasó una vez, ver migración `drop_old_create_owner_overload`).
- `public.create_patient(p_owner_id, p_name, p_species, p_sex, p_breed, p_birth_date, p_weight_kg)` — RPC `SECURITY DEFINER`, valida que `p_owner_id` pertenezca a la misma clínica antes de insertar.
- UI: `src/components/create-owner-drawer.tsx` (usado en `/dashboard/owners`) y `src/components/create-patient-drawer.tsx` (global, botón "Crear paciente" en el sidebar) — este último permite seleccionar un titular existente o crear uno nuevo inline.
- **Gotcha de tipos:** `patients.select("owner:owners(full_name, phone)")` es un embed *to-one* (FK `patients.owner_id -> owners.id`), PostgREST lo devuelve como objeto plano en runtime, pero el query builder sin `Database` generado lo infiere como array. Hay que castear el resultado (ver `PatientRow` en `src/app/dashboard/patients/page.tsx`) y acceder con `.owner?.full_name`, **no** `.owner?.[0]?.full_name`.

## Storage — fotos de pacientes

- Bucket `patient-photos` (público, para poder usar `getPublicUrl` directo sin firmar URLs — las fotos de mascotas no son datos sensibles).
- Path: `{user_id}/{patient_id}.{ext}` (el id del usuario que sube la foto). Policies en `storage.objects`: insert/update/delete/**select** exigen `(storage.foldername(name))[1] = auth.uid()::text`.
- **Causa raíz real de "sube pero nunca queda en el bucket" (ya resuelto):** las subidas fallaban con `"new row violates row-level security policy for table \"objects\""` incluso con una policy de INSERT correcta. La causa: **faltaba la policy de SELECT**. El servicio de Storage hace internamente `INSERT ... RETURNING` para devolver los metadatos del objeto creado, y Postgres exige una policy de SELECT permisiva para autorizar ese `RETURNING` — sin ella, el INSERT completo se rechaza, no solo se omite la fila devuelta. Se confirmó reproduciendo el mismo `INSERT ... RETURNING` manualmente: fallaba sin policy de SELECT y funcionaba en cuanto se agregó. Si se crea un bucket/policy nuevo para otra cosa, **siempre agregar las 4 policies (select/insert/update/delete)**, no solo las 3 que "parecen" necesarias.
  - Nota: la primera policy de INSERT usaba `private.my_clinic_id()` en vez de `auth.uid()` directo; se cambió a `auth.uid()` porque es el patrón más simple, pero **no era la causa real del bug** — quedó como mejora, no como fix.
  - Nota 2: simular RLS con `execute_sql` + `set local request.jwt.claims` fue el método que finalmente permitió aislar esto (probando el mismo `INSERT ... RETURNING` con y sin la policy de SELECT), pero cuidado: un `INSERT` simple sin `RETURNING` puede pasar aunque falte la policy de SELECT, dando una falsa sensación de que todo está bien.
- Flujo de subida (`create-patient-drawer.tsx`): se crea el paciente primero vía RPC, y solo si hay foto se sube a Storage y se hace un `update` de `patients.photo_url` con la URL pública. Si la subida falla, el paciente igual queda creado (se avisa con un toast que incluye el mensaje real del error, y se loguea en consola con `console.error`).

## Skills instaladas

Se instalaron las Agent Skills de Supabase (`npx skills add supabase/agent-skills`) en `.agents/skills/`:

- **`supabase`** — guía general para trabajar con Supabase desde el agente.
- **`supabase-postgres-best-practices`** — buenas prácticas de Postgres (índices, RLS, migraciones) que el agente debe seguir al proponer cambios de esquema.

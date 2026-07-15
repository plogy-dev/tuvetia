# Base de datos

Este proyecto usa **Supabase** (Postgres) como base de datos, conectado a través de un servidor MCP dedicado al proyecto (no el conector genérico de la cuenta de claude.ai).

## Conexión

- **Project ref:** `auxlnexhkmtoedrzfsnz`
- **Servidor MCP:** `supabase` (scope: `project`), configurado en [.mcp.json](.mcp.json) en la raíz del repo:

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=auxlnexhkmtoedrzfsnz"
    }
  }
}
```

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

Hasta que esto se complete, las herramientas del MCP de Supabase (migraciones, queries, etc.) no están disponibles para este proyecto específico.

## Cómo se opera la base de datos vía MCP

Una vez autenticado, Claude Code expone herramientas con el prefijo `mcp__supabase__*` para trabajar contra este proyecto sin salir del asistente, entre ellas:

- `list_tables` / `get_project` — inspeccionar el esquema y metadatos del proyecto antes de tocar nada.
- `apply_migration` — aplicar una migración SQL versionada al proyecto (esto es lo que se usa para crear/alterar tablas, ej. las tablas de `auth`).
- `execute_sql` — correr SQL puntual (consultas, seeds, fixes) fuera del flujo de migraciones.
- `generate_typescript_types` — generar los tipos TS del esquema para usarlos en el código de Next.js.
- `get_logs` / `get_advisors` — diagnóstico y recomendaciones de seguridad/performance antes o después de un cambio.
- `get_project_url` / `get_publishable_keys` — obtener la URL del proyecto y la clave pública para configurar el cliente de Supabase en el frontend (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

**Convención de trabajo:** los cambios de esquema (nuevas tablas, columnas, políticas RLS) se aplican siempre vía `apply_migration` para que queden versionados como migraciones, no con `execute_sql` suelto. `execute_sql` se reserva para lectura o correcciones puntuales de datos.

## Autenticación

Login sin contraseña (magic link) + Google OAuth, usando `@supabase/ssr` (helpers en `src/lib/supabase/`: `client.ts`, `server.ts`, `middleware.ts`) y `src/proxy.ts` (en esta versión de Next.js el archivo `middleware.ts` se renombró a `proxy.ts` — ver `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`) para refrescar la sesión y proteger `/dashboard`.

**Flujo de alta (ya estaba modelado en el esquema, no lo inventamos):**

1. `public.handle_new_user()` — trigger `on_auth_user_created` en `auth.users` (AFTER INSERT) que crea una fila mínima en `public.profiles` (sin `clinic_id`, rol por defecto `vet`).
2. `public.create_clinic(clinic_name text)` — RPC `SECURITY DEFINER` que crea la clínica y actualiza el `profile` del usuario autenticado (`auth.uid()`) a `clinic_id` + `role = 'admin'`. La llama `ensureClinicForUser` (`src/lib/supabase/ensure-clinic.ts`) justo después de establecer sesión en `/auth/confirm` (magic link) y `/auth/callback` (Google OAuth), solo si el profile todavía no tiene `clinic_id`. El nombre de la clínica sale de `user_metadata.clinic_name` (capturado en el signup) o de un fallback si vino por Google.
3. `public.accept_invitation(invite_token text)` — RPC ya existente para que un usuario invitado (vía tabla `invitations`) quede asociado a una clínica existente con el rol de la invitación. Aún no hay UI que la use.

**Nota de RLS:** la policy `profiles_select` se amplió (`clinic_id = private.my_clinic_id() OR id = auth.uid()`) porque un usuario recién creado tiene `clinic_id IS NULL` y sin esa condición no podía ni leer su propia fila — bloqueaba el paso 2 del flujo de alta.

**Rutas:** `/` (login), `/signup` (registro), `/auth/confirm` (verifica el magic link), `/auth/callback` (intercambia el `code` de OAuth).

## Skills instaladas

Se instalaron las Agent Skills de Supabase (`npx skills add supabase/agent-skills`) en `.agents/skills/`:

- **`supabase`** — guía general para trabajar con Supabase desde el agente.
- **`supabase-postgres-best-practices`** — buenas prácticas de Postgres (índices, RLS, migraciones) que el agente debe seguir al proponer cambios de esquema.

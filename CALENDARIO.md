# Calendario interno + Google Calendar / Outlook Calendar

Agenda de citas de la clínica. UI con **react-big-calendar** (mes/semana/día, drag&drop), datos en
`public.appointments` (aislada por clínica vía RLS), y **sync opcional con Google Calendar y/o
Microsoft Outlook Calendar contra UNA cuenta por clínica: la del administrador** (ambos proveedores
en paralelo, independientes entre sí).

## Quién sincroniza (v2, 2026-08-02 — migración `0048`)

**Una sola cuenta por clínica: la del administrador que la creó** (`clinics.owner_id`, fijado en
`private.provision_new_clinic`). Push, pull y delete resuelven esa cuenta a partir del `clinic_id` de
la cita — ya no dependen de quién esté logueado. Solo el admin ve el botón "Conectar"; el resto del
equipo ve el estado y puede "Sincronizar".

**Las citas llegan por correo.** El titular (`owners.email`) y el veterinario asignado
(`vet_id` → `auth.users.email`) entran como `attendees` del evento, así que reciben la invitación y
sus recordatorios del propio Google/Microsoft. Google necesita `?sendUpdates=all` explícito para
mandarlas; Graph notifica por default.

**Por qué cambió.** Antes cada vet conectaba su cuenta y el push iba a la del creador de la cita
mientras el pull mezclaba las de todos sin marcar el origen — de ahí el incidente del 2026-07-31 (el
calendario personal de un vet entró como 1.567 citas de la clínica). Era el pendiente "sync por-vet
vs. calendario compartido — a decidir" de este documento.

Además, `create_appointment`/`update_appointment` ahora **exigen** paciente, titular, veterinario y
motivo, y validan que el paciente pertenezca al titular indicado (no solo a la clínica).

## Estado

- **v1a — CRUD + UI interno: LISTO y verificado** (`tsc` + `eslint` + `next build` en verde; RPCs
  probadas con aislamiento cross-clínica por MCP).
- **v1b/v1c — Google sync: código completo, requiere activación** (config externa de Google + Supabase;
  ver §Activación). Sin esa config, el calendario interno funciona igual; el sync simplemente no dispara.
- **v1d — Auto-sync en login con Google: LISTO** (2026-07-30). `login-form`/`signup-form` ya piden el
  scope `calendar.events` en el propio OAuth de Google (`access_type=offline`); `/auth/callback` guarda
  el refresh token automáticamente (no hace falta el botón "Conectar"). El pull incremental corre solo
  al abrir `/dashboard/calendario` (no hay cron; ver §Activación punto 4 y §Pull automático).
- **v1e — Microsoft/Outlook sync: código completo, requiere activación** (2026-07-31, espejo exacto de
  v1b/v1c/v1d con Microsoft Graph — ver §Activación de Microsoft/Outlook sync). Mismo patrón: scope
  pedido en el login (`offline_access Calendars.ReadWrite`, ver `microsoft-calendar-scope.ts`),
  vinculación automática en `/auth/callback` (rama por `app_metadata.provider === "azure"`), botón
  "Conectar Outlook Calendar" como fallback manual, y push/delete/pull independientes de Google (una
  clínica puede tener conectados ambos calendarios a la vez; cada cita se empuja a los dos si
  corresponde).
- **v2 — Una cuenta por clínica + invitaciones por correo: LISTO** (2026-08-02, migración `0048`;
  `tsc` + `eslint` + `next build` + 425 pruebas en verde, RPCs endurecidas probadas por MCP). Ver
  §Quién sincroniza.

## Modelo de datos

- **`public.appointments`** (ya existía en el esquema base): `clinic_id, patient_id, owner_id, vet_id,
  title, reason, status, starts_at, ends_at, google_event_id, microsoft_event_id, notes, created_by`.
  `microsoft_event_id` (migración `0047`) es el id remoto del evento en Outlook — columna separada de
  `google_event_id` porque una misma cita puede empujarse a los dos proveedores a la vez. Enum
  `appointment_status`: `scheduled|confirmed|in_progress|completed|canceled|no_show`. RLS por
  `private.my_clinic_id()` (4 policies) + índice `idx_appointments_starts (clinic_id, starts_at)`.
- **`public.clinics.owner_id`** (migración `0048`): el administrador de la clínica — la única cuenta
  cuyo Google/Outlook se sincroniza. Se fija al crear la clínica y no cambia con el rol (`profiles.role
  = 'admin'` puede haber en varios miembros; `owner_id` es uno solo).
- **`public.calendar_integrations`** (migración `0007`): refresh_token + estado de sync por
  `(user_id, provider)`, `provider` es `'google'` o `'microsoft'`. Tras `0048` hay a lo sumo **una fila
  por (clínica, proveedor)**: la del admin. La columna `google_calendar_id` es genérica pese al nombre
  (se reutiliza para el id de calendario de Microsoft también, para no tocar el `grant select
  (columnas)` de la migración `0007`). **`refresh_token` y `sync_token` tienen el SELECT revocado a
  anon/authenticated** (solo `service_role` los lee); el cliente solo ve columnas de estado, y desde
  `0048` las ve por clínica (no solo su propia fila) para poder mostrar si el admin conectó.

## Migraciones (aplicadas al principal por MCP)

- `0006_appointment_rpcs.sql` — `create_appointment(...)` y `update_appointment(...)` `SECURITY DEFINER`
  (resuelven `clinic_id` server-side y validan que patient/owner/vet sean de la clínica). Mover/redimensionar
  y borrar van por UPDATE/DELETE directo bajo RLS.
- `0007_calendar_integrations.sql` — tabla + RLS + revoke/grant de columnas secretas.
- `0008_calendar_feeds.sql` — tabla `calendar_feeds` (token por clínica) + RPC `ensure_calendar_feed()` para el feed ICS.
  > Nota: la corrección del grant de columnas se aplicó en vivo por `execute_sql`; **el archivo `0007` es la
  > fuente de verdad** (trae ya el `revoke select on table` + `grant select (columnas no-secretas)`), así que
  > un `supabase db push` en otro entorno queda correcto.
- `0042`/`0043_appointments_google_event_unique*.sql` — índice único `(clinic_id, google_event_id)` para
  el upsert en bloque del pull. `0043` reemplaza el índice parcial de `0042` por uno no-parcial: Postgres
  no acepta un índice parcial como target de `ON CONFLICT` sin repetir el `WHERE`, y el `.upsert()` de
  PostgREST no permite ese predicado en el conflict target.
- `0047_appointments_microsoft_event.sql` — columna `microsoft_event_id` + el mismo índice único
  no-parcial `(clinic_id, microsoft_event_id)`, aplicando directamente la lección de `0043` (sin pasar
  primero por la versión parcial rota). Nació como `0044` y se renumeró: ese número lo tomó
  `0044_realtime_whatsapp_messages.sql` mientras esta rama estaba sin commitear.
- `0048_calendar_admin_redesign.sql` — `clinics.owner_id` (+ backfill y `provision_new_clinic`),
  `create_appointment`/`update_appointment` con paciente/titular/vet/motivo obligatorios y validación
  paciente↔titular, RLS de `calendar_integrations` por clínica, y borrado de las conexiones que no
  eran del admin. Ver §Quién sincroniza.

## Front (todo lo lleva nuestro equipo; coordinar con Santiago por ser plataforma)

- `src/app/dashboard/calendario/page.tsx` — server component: carga semana actual + selects + estado de conexión.
- `src/components/calendar/appointment-calendar.tsx` — calendario cliente (react-big-calendar + DnD).
- `src/components/calendar/create-appointment-drawer.tsx` — drawer crear/editar/eliminar (patrón `create-owner-drawer`).
- `src/components/calendar/google-calendar-connect.tsx` — conectar / sincronizar Google.
- `src/components/calendar/microsoft-calendar-connect.tsx` — conectar / sincronizar Outlook (espejo).
- `src/lib/appointments.ts` — tipos + estados + helpers de mapeo a eventos.
- `src/lib/google-calendar.ts` (SOLO servidor) — push/pull/delete contra la Calendar API (REST, sin deps).
- `src/lib/microsoft-calendar.ts` (SOLO servidor) — mismo patrón contra Microsoft Graph.
- `src/lib/google-calendar-scope.ts` / `src/lib/microsoft-calendar-scope.ts` — scopes de OAuth, pedidos
  en login/signup y en el botón de reconexión manual.
- `src/lib/supabase/admin.ts` (SOLO servidor) — cliente `service_role`.
- Route handlers: `src/app/api/google/calendar/{connect,push,delete,sync}/route.ts` y
  `src/app/api/microsoft/calendar/{connect,push,delete,sync}/route.ts`.
- Sidebar: "Calendario" → `/dashboard/calendario`.
- Dependencias nuevas: `react-big-calendar`, `date-fns` (+ `@types/react-big-calendar`).

## Activación de Google sync (una persona, config externa)

1. **Google Cloud** → OAuth client (Web) con scope `https://www.googleapis.com/auth/calendar.events`;
   pantalla de consentimiento publicada. Copiar **Client ID/Secret**.
2. **Supabase Auth → Google provider**: usar ese Client ID/Secret (o asegurar que devuelva refresh token).
   Añadir `https://<vercel>/dashboard/calendario?google=connected` a las Redirect URLs.
3. **Vercel → Environment Variables** (server, NO `NEXT_PUBLIC_`):
   - `SUPABASE_SERVICE_ROLE_KEY` — service_role del principal (lee refresh_token, escribe google_event_id).
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
4. **Vinculación automática en el login del ADMIN** (2026-07-30, acotada al admin en `0048`).
   `login-form`/`signup-form` piden el scope `calendar.events` (`access_type=offline`) en el mismo
   `signInWithOAuth("google")` del login/registro. `/auth/callback` captura el `provider_refresh_token`
   y llama `upsertGoogleIntegration` **solo si quien entra es `clinics.owner_id`** — el resto del
   equipo puede loguear con Google sin que se guarde nada (su cuenta no sincroniza). **Contrapartida
   asumida:** TODO login/registro con Google (no solo quien usa el sync) muestra la pantalla de "app no
   verificada" de Google hasta que la app pase su verificación (~10 días; en modo Testing se pasa con
   "Continuar"). El scope está centralizado en `src/lib/google-calendar-scope.ts`.
   - El botón **Calendario → "Conectar Google Calendar"** (`/api/google/calendar/connect`) se mantiene
     como fallback manual para el admin que entró con **email o Microsoft** (esos logins no pasan por
     Google OAuth y por tanto nunca reciben el refresh token), o para reconectar si revocó el acceso.
     A quien no es admin ni siquiera se le muestra (y la ruta responde 403).
5. Con el calendario vinculado: crear/editar/mover/borrar una cita hace **push** al calendario del
   admin, **invitando por correo** al titular y al veterinario asignado (`attendees` +
   `sendUpdates=all`). El **pull** incremental (por `syncToken`) corre bajo demanda con el botón
   **"Sincronizar"**. No hay cron ni pull automático al abrir la página (ver el comentario en
   `page.tsx`: bloquear el render en una API externa colgó el calendario el 2026-07-31). Si se
   necesita más frecuencia sin depender de que alguien apriete el botón, el patrón a copiar es el cron
   de `cartera` (`vercel.json` + `.github/workflows/cartera-sweep.yml` +
   `src/app/api/cron/cartera/route.ts`).

## Activación de Microsoft/Outlook sync (una persona, config externa)

Espejo exacto del flujo de Google (§Activación de Google sync); mismos pasos, otro proveedor.

1. **Azure Portal** → App registration (Web) con permiso delegado `Calendars.ReadWrite` (+ `offline_access`
   para el refresh token) — consentimiento de admin si el tenant lo exige. Copiar **Client ID/Secret**
   (Certificates & secrets; los secrets de Azure VENCEN, a los 6/12/24 meses — agendar renovación).
2. **Azure Portal** → misma app → Authentication → Redirect URIs: agregar
   `https://<proyecto>.supabase.co/auth/v1/callback` (el callback de **Supabase**, no el de la app).
3. **Supabase Auth → Azure provider**: cargar ese Client ID/Secret y el Tenant (debe coincidir con
   `MICROSOFT_TENANT_ID` del paso 4 — `common` si el App registration acepta cuentas personales +
   trabajo/escuela, o el Tenant ID si es single-tenant).
4. **Vercel → Environment Variables** (server, NO `NEXT_PUBLIC_`): `MICROSOFT_CLIENT_ID`,
   `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (default `common` si no se define).
5. **Vinculación automática en el login del ADMIN**, igual que Google: `login-form`/`signup-form` piden
   el scope `offline_access Calendars.ReadWrite` en el mismo `signInWithOAuth("azure")`;
   `/auth/callback` detecta el provider (`app_metadata.provider === "azure"`) y llama
   `upsertMicrosoftIntegration` en vez de `upsertGoogleIntegration` — **solo si quien entra es
   `clinics.owner_id`**. El botón **Calendario → "Conectar Outlook Calendar"** queda como fallback
   manual para el admin que entró con email o Google, o para reconectar tras revocar el acceso.
6. Con el calendario vinculado: crear/editar/mover/borrar una cita hace **push** al Outlook del admin,
   **invitando** al titular y al vet asignado (`attendees`; Graph notifica por default, sin el
   `sendUpdates` que sí necesita Google). Corre en paralelo al push a Google si también está conectado
   — son integraciones independientes. El **pull** incremental corre bajo demanda con "Sincronizar".
   **Limitación propia de Graph** (no existe en Google): el pull usa `/me/calendarView/delta`, cuya
   ventana de tiempo queda FIJADA en el primer request (hoy: 30 días atrás / 180 adelante) — eventos
   fuera de esa ventana no entran sin reiniciar el sync completo (se resetea solo si Graph devuelve 410).

## Feed ICS — fallback de solo lectura (SIN OAuth ni verificación de Google)

Alternativa de mínima fricción para "ver mis citas en Google" sin conectar la cuenta:

- **UI:** Calendario → botón **"Enlace ICS"** → genera la URL secreta de la clínica (RPC `ensure_calendar_feed`) y la muestra para copiar. El vet la pega en Google Calendar → **Otros calendarios → Desde URL**.
- **Endpoint:** `GET /api/calendar/ics/[token]` (`src/app/api/calendar/ics/[token]/route.ts`) → devuelve `text/calendar` con las citas de la clínica del token. **Sin login ni OAuth**: el `token` es la credencial (bearer en la URL, como los ICS privados de Google). Lee con `service_role` acotando por `clinic_id`.
- **Generador:** `src/lib/ics.ts` (`buildIcs`, RFC 5545: escaping, CRLF, UTC, folding, STATUS).
- **Requiere** `SUPABASE_SERVICE_ROLE_KEY` en el server (Vercel) — el mismo que ya usa el sync de Google.
- **Limitaciones:** una vía (nosotros → Google), **solo lectura**, y Google refresca los ICS externos **lento** (horas). Ideal para "ver la agenda"; para bidireccional en tiempo real, usar la conexión OAuth (v1b/v1c).

## Verificación

- Automática: `tsc --noEmit`, `eslint src`, `next build`, `vitest run` (425 pruebas).
- MCP (`0048`, con el JWT del vet simulado): `create_appointment` rechaza sin veterinario, sin motivo,
  sin paciente, y con un **paciente que no es del titular indicado**; el caso completo crea. Antes de
  `0048` también: paciente de otra clínica rechazado ("Patient does not belong to your clinic").
- Manual (pendiente de hacer con las credenciales de Google/Azure cargadas): crear cita desde el drawer
  → elegir paciente autocompleta el titular → intentar un paciente de otro titular lo bloquea con nota
  → aparece en semana/mes → arrastrar para mover (persiste `starts_at`) → el evento aparece **en el
  calendario del admin** con el titular y el vet como invitados, y a ambos les llega el correo →
  editar en Google → "Sincronizar" lo refleja. Como no-admin: no se ve el botón "Conectar", solo el
  estado.

## Pendientes / decisiones abiertas

- ~~**Sync por-vet** vs. calendario compartido de clínica~~ — **RESUELTO 2026-08-02** (migración `0048`):
  una cuenta por clínica, la del admin. Ver §Quién sincroniza.
- **Push notifications de Google** (`events.watch` + webhook) para pull casi en tiempo real: hoy el pull es a
  demanda ("Sincronizar") / carga de página. Es el estirable de v1c.
- **Titular sin correo**: hoy simplemente no se lo invita (la cita se crea igual). Si se quiere que el
  correo del titular sea obligatorio para agendar, hay que pedirlo en el alta del titular primero.
- **Endurecer RPCs**: `create_appointment`/`update_appointment` quedan anon-executable como el resto de
  `create_*` (bloqueadas por el chequeo de clínica). Si se endurece, hacerlo consistente para todas.
- **Eventos externos** creados en Google entran como cita mínima (sin paciente/titular); se pueden completar
  luego editándolas.

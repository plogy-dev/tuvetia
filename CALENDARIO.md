# Calendario interno + Google Calendar

Agenda de citas de la clínica. UI con **react-big-calendar** (mes/semana/día, drag&drop), datos en
`public.appointments` (aislada por clínica vía RLS), y **sync opcional con Google Calendar por vet**.

## Estado

- **v1a — CRUD + UI interno: LISTO y verificado** (`tsc` + `eslint` + `next build` en verde; RPCs
  probadas con aislamiento cross-clínica por MCP).
- **v1b/v1c — Google sync: código completo, requiere activación** (config externa de Google + Supabase;
  ver §Activación). Sin esa config, el calendario interno funciona igual; el sync simplemente no dispara.

## Modelo de datos

- **`public.appointments`** (ya existía en el esquema base): `clinic_id, patient_id, owner_id, vet_id,
  title, reason, status, starts_at, ends_at, google_event_id, notes, created_by`. Enum
  `appointment_status`: `scheduled|confirmed|in_progress|completed|canceled|no_show`. RLS por
  `private.my_clinic_id()` (4 policies) + índice `idx_appointments_starts (clinic_id, starts_at)`.
- **`public.calendar_integrations`** (migración `0007`): refresh_token de Google + estado de sync por
  `(user_id, provider)`. **`refresh_token` y `sync_token` tienen el SELECT revocado a
  anon/authenticated** (solo `service_role` los lee); el cliente solo ve columnas de estado.

## Migraciones (aplicadas al principal por MCP)

- `0006_appointment_rpcs.sql` — `create_appointment(...)` y `update_appointment(...)` `SECURITY DEFINER`
  (resuelven `clinic_id` server-side y validan que patient/owner/vet sean de la clínica). Mover/redimensionar
  y borrar van por UPDATE/DELETE directo bajo RLS.
- `0007_calendar_integrations.sql` — tabla + RLS + revoke/grant de columnas secretas.
  > Nota: la corrección del grant de columnas se aplicó en vivo por `execute_sql`; **el archivo `0007` es la
  > fuente de verdad** (trae ya el `revoke select on table` + `grant select (columnas no-secretas)`), así que
  > un `supabase db push` en otro entorno queda correcto.

## Front (todo lo lleva nuestro equipo; coordinar con Santiago por ser plataforma)

- `src/app/dashboard/calendario/page.tsx` — server component: carga semana actual + selects + estado de conexión.
- `src/components/calendar/appointment-calendar.tsx` — calendario cliente (react-big-calendar + DnD).
- `src/components/calendar/create-appointment-drawer.tsx` — drawer crear/editar/eliminar (patrón `create-owner-drawer`).
- `src/components/calendar/google-calendar-connect.tsx` — conectar / sincronizar Google.
- `src/lib/appointments.ts` — tipos + estados + helpers de mapeo a eventos.
- `src/lib/google-calendar.ts` (SOLO servidor) — push/pull/delete contra la Calendar API (REST, sin deps).
- `src/lib/supabase/admin.ts` (SOLO servidor) — cliente `service_role`.
- Route handlers: `src/app/api/google/calendar/{connect,push,delete,sync}/route.ts`.
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
4. En la app: **Calendario → "Conectar Google Calendar"** (reautoriza offline; guarda el refresh token).
   Desde ahí, crear/editar/mover/borrar una cita hace **push** a Google; **"Sincronizar"** hace el **pull**
   incremental (por `syncToken`).

## Verificación

- Automática: `tsc --noEmit`, `eslint src`, `next build` (los 4 route handlers + `/dashboard/calendario` compilan).
- MCP: `create_appointment` probado con `set local role authenticated` — creación válida OK; paciente de otra
  clínica **rechazado** ("Patient does not belong to your clinic").
- Manual: crear cita desde el drawer → aparece en semana/mes → arrastrar para mover (persiste `starts_at`) →
  (con Google) verificar evento creado en Google → editar en Google → "Sincronizar" lo refleja.

## Pendientes / decisiones abiertas

- **Sync por-vet** usando el refresh token del propio vet (calendario `primary`). Alternativa: calendario
  compartido de clínica (a decidir).
- **Push notifications de Google** (`events.watch` + webhook) para pull casi en tiempo real: hoy el pull es a
  demanda ("Sincronizar") / carga de página. Es el estirable de v1c.
- **Endurecer RPCs**: `create_appointment`/`update_appointment` quedan anon-executable como el resto de
  `create_*` (bloqueadas por el chequeo de clínica). Si se endurece, hacerlo consistente para todas.
- **Eventos externos** creados en Google entran como cita mínima (sin paciente/titular); se pueden completar
  luego editándolas.

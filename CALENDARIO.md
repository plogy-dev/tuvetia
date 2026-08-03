# Calendario interno + Google (Composio) / Outlook Calendar

Agenda de citas de la clínica. UI con **react-big-calendar** (semana/agenda, drag&drop), datos en
`public.appointments` (aislada por clínica vía RLS), y **sincronización opcional de una sola vía
hacia el calendario personal de cada veterinario** (Google u Outlook, a elección).

## El modelo, en tres reglas (v3 — migración `0049`)

1. **Nada se conecta solo.** Cada usuario conecta su calendario a mano desde **Conexiones**,
   eligiendo Google **o** Outlook (uno de los dos; para cambiar, se desconecta primero). El login
   ya no pide permisos de calendario.
2. **El calendario es de cada usuario, no de la clínica.** Una cita se crea en el calendario del
   **veterinario asignado** (`appointments.vet_id`), e invita por correo al **titular** y al propio
   vet. Si ese vet no conectó nada, la cita vive igual en Tuvetia y no pasa nada más.
3. **Una sola vía: Tuvetia escribe, nunca lee.** No existe *pull*. `public.appointments` es la
   única fuente de verdad de la agenda.

### Por qué así (los dos intentos anteriores)

- **v1 — por vet, automático.** El login con Google pedía el scope de calendario y `/auth/callback`
  guardaba el token sin que nadie lo pidiera. El *pull* trajo el calendario **personal** de un vet a
  la agenda de la clínica: **11.695 filas** "Comer"/"Trabajo"/"Dormir" contra 3 citas reales, que
  siguen hoy en la base de la clínica de prueba.
- **v2 — una cuenta por clínica (`0048`).** Acotó a la cuenta del admin pero mantuvo el
  automatismo, y apareció el segundo defecto: `session.provider_refresh_token` es el token del
  proveedor con el que se inició **sesión**, no el del botón que se apretó, y nadie lo verificaba.
  Un token de Microsoft quedó guardado en la fila de Google (medido: ambas filas con prefijo `M.C`
  y largo 417 idéntico) y Google lo rechazaba con `invalid_grant` días después, sin señalar la causa.

v3 no parchea ninguno de los dos: **elimina los canales que los hacían posibles**. Sin lectura no
puede entrar basura; sin vinculación automática nadie queda conectado sin saberlo. El chequeo de
proveedor antes de guardar un token se conserva, en el cliente y en la ruta.

## Modelo de datos

- **`public.appointments`** (esquema base): `clinic_id, patient_id, owner_id, vet_id, title, reason,
  status, starts_at, ends_at, google_event_id, microsoft_event_id, calendar_owner_id, notes,
  created_by`. Enum `appointment_status`:
  `scheduled|confirmed|in_progress|completed|canceled|no_show`. RLS por `private.my_clinic_id()`.
  - `google_event_id` / `microsoft_event_id` (`0042`/`0043`/`0047`) — id remoto del evento.
  - `calendar_owner_id` (`0049`) — **en el calendario de quién** vive ese evento. Sin esto, al
    cambiar el veterinario asignado el evento viejo quedaba de fantasma en la agenda del anterior,
    sin forma de encontrarlo para borrarlo.
- **`public.calendar_integrations`** (`0007`): **sólo la usa Outlook**, y en vías de desaparecer.
  Google migró a Composio y ya no guarda nada acá: su token vive del lado de Composio y el estado se
  le pregunta a quien lo tiene. Las filas de Google que hayan quedado son **credenciales muertas** —
  nadie las lee. Cuando Outlook también migre, la tabla se puede borrar.

## Migraciones

- `0006_appointment_rpcs.sql` — `create_appointment` / `update_appointment` `SECURITY DEFINER`.
- `0007_calendar_integrations.sql` — tabla + RLS + revoke/grant de columnas secretas.
- `0008_calendar_feeds.sql` — `calendar_feeds` + `ensure_calendar_feed()` para el feed ICS.
- `0042`/`0043_appointments_google_event_unique*.sql` — índice único `(clinic_id, google_event_id)`.
  `0043` reemplaza el índice parcial de `0042` por uno no-parcial: Postgres no acepta un índice
  parcial como target de `ON CONFLICT` sin repetir el `WHERE`.
- `0047_appointments_microsoft_event.sql` — `microsoft_event_id` + su índice único no-parcial.
  Nació como `0044` y se renumeró: ese número lo tomó `0044_realtime_whatsapp_messages`.
- `0048_calendar_admin_redesign.sql` — **lo que sobrevive de v2**: `clinics.owner_id` y, sobre todo,
  las RPCs endurecidas — paciente, titular, veterinario y motivo **obligatorios**, y el paciente
  debe pertenecer al titular indicado. Eso es agendamiento, no sincronización, y se conserva entero.
- `0049_calendario_por_usuario.sql` — `appointments.calendar_owner_id` y la RLS de
  `calendar_integrations` de vuelta a por-usuario.

## Front

- `src/app/dashboard/calendario/page.tsx` — server component: carga la semana + opciones del drawer.
- `src/components/calendar/appointment-calendar.tsx` — calendario cliente (react-big-calendar + DnD).
- `src/components/calendar/create-appointment-drawer.tsx` — crear/editar/eliminar. Elegir paciente
  autocompleta el titular; un paciente que no es de ese titular se bloquea con una nota.
- `src/components/settings/calendar-settings.tsx` — **conectar/desconectar** (vive en Conexiones).
- `src/components/patient/patient-appointments.tsx` — las citas en la ficha del paciente.
- `src/lib/composio/calendario.ts` (SOLO servidor) — **Google, vía Composio**: conectar, estado,
  empujar y borrar. `src/lib/microsoft-calendar.ts` — Outlook, todavía con OAuth propio.
- Rutas: `src/app/api/composio/calendario/{connect,disconnect}` (Google) y
  `src/app/api/{google,microsoft}/calendar/{push,delete}` — el push/delete de Google conserva su ruta
  y por dentro llama a Composio.

## Activación (config externa, una vez)

**Google (Composio)** — sólo dos variables: `COMPOSIO_API_KEY` (con permiso de **escritura** sobre
`connected_accounts`) y `COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID`. No hay credenciales OAuth propias
que mantener ni tokens nuestros que guardar.

Con eso desaparecen tres problemas que el camino anterior tenía y que están documentados abajo por si
alguien piensa en volver: el `invalid_client` por credenciales que no coinciden con las de Supabase
Auth, el `invalid_grant` semanal del modo Testing, y —el peor— que
`session.provider_refresh_token` es el token del proveedor con el que se **inició sesión**, no el del
botón que se apretó: alguien entró con Microsoft y su token quedó guardado en la fila de Google.

**Outlook** — 1) Azure → App registration con permiso delegado `Calendars.ReadWrite` +
`offline_access` (los secrets de Azure **vencen**: agendar renovación). 2) Redirect URI:
`https://<proyecto>.supabase.co/auth/v1/callback` (el de **Supabase**, no el de la app).
3) Supabase Auth → Azure provider con ese Client ID/Secret y el Tenant. 4) Vercel:
`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (default `common`).

> **Modo Testing de Google** — ya no aplica a Tuvetia: la app de Google es la de Composio, no la
> nuestra. Queda anotado porque sigue valiendo para Outlook y para cualquier vuelta atrás: mientras
> una app propia no esté publicada, los refresh token **vencen a los 7 días**.

> **Pendiente de probar con una conexión real:** de qué campo sale el id del evento creado. Composio
> **no declara** la forma de la respuesta de `GOOGLECALENDAR_CREATE_EVENT` (su esquema de salida
> viene vacío), así que se leen las variantes plausibles. Si ninguna aparece, `empujarCita` **falla
> ruidosamente** en vez de guardar null: una cita sin referencia al evento haría que la próxima
> edición creara un duplicado en el calendario en lugar de actualizar el que ya existe.

## Feed ICS — alternativa de solo lectura (sin OAuth)

Para ver la agenda en cualquier calendario sin conectar la cuenta: Calendario → **"Enlace ICS"**
genera la URL secreta de la clínica (RPC `ensure_calendar_feed`) y se pega en Google Calendar →
*Otros calendarios → Desde URL*. Endpoint `GET /api/calendar/ics/[token]`
(`src/app/api/calendar/ics/[token]/route.ts`), generador `src/lib/ics.ts` (RFC 5545). El `token` es
la credencial. **Limitación:** los proveedores refrescan los ICS externos lento (horas).

## Verificación

- Automática: `tsc --noEmit`, `eslint src`, `next build`, `vitest run`.
- MCP (`0048`, con el JWT del vet simulado): `create_appointment` rechaza sin veterinario, sin
  motivo, sin paciente, y con un **paciente que no es del titular indicado**; el caso completo crea.
- Manual (requiere las credenciales cargadas): Conexiones → conectar Google → crear una cita
  asignada a ese vet → el evento aparece **en su calendario** con el titular invitado → cambiar el
  veterinario → el evento se va del calendario del primero y aparece en el del segundo → borrar la
  cita → desaparece. Confirmar que **nada** del calendario personal entra a Tuvetia, y que el login
  con Google ya **no** pide permiso de calendario.

## Pendientes

- ~~Sync por-vet vs. calendario de clínica~~ — cerrado en v3: por usuario, explícito, una sola vía.
- **Las 11.695 citas basura de v1** siguen en la base de la clínica de prueba. No se borraron por
  decisión del usuario; se limpian con un `delete` sobre las filas con `google_event_id` no nulo y
  paciente/titular/vet en `NULL`.
- **Titular sin correo**: no se lo invita (la cita se crea igual). Si se quiere exigir el correo
  para agendar, hay que pedirlo antes en el alta del titular.

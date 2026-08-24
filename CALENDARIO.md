# Calendario interno + Google Calendar / Outlook Calendar (los dos por Composio)

Agenda de citas de la clínica. UI con **react-big-calendar** (semana/agenda, drag&drop), datos en
`public.appointments` (aislada por clínica vía RLS), y **sincronización opcional de una sola vía
hacia el calendario de cada persona** (Google Calendar u Outlook, los dos por Composio).

## El modelo, en tres reglas (v5)

1. **Nada se conecta solo.** El calendario se conecta a mano desde **Integraciones**, y lo conectan
   **los dos roles**. El login no pide permisos de calendario.
2. **El evento vive en el calendario del veterinario asignado**, con el del administrador de la
   clínica (`clinics.owner_id`, con respaldo al primer perfil `admin`) como red si esa persona no
   conectó el suyo. Van **invitados** el **titular**, **todos los administradores** y **quien agendó
   la cita** — como cuando llega una invitación a una reunión. Se adjunta además la **dirección de
   la clínica** (`clinics.address` / `city`), que es lo que el teléfono del titular convierte en un
   enlace a mapas.
3. **Una sola vía: Tuvetia escribe, nunca lee.** No existe *pull*. `public.appointments` es la
   única fuente de verdad de la agenda.

> **Que los admins vayan invitados no es un detalle: es lo que sostiene la regla 2.** Un
> administrador sigue teniendo la clínica entera en su calendario —le llegan todas las citas— y el
> vet además tiene la suya. Las dos cosas a la vez, que es lo que v3 no tenía. Y coincide con lo que
> gobierna la agenda dentro de la app: el admin ve el calendario completo, el vet ve el suyo.

### Por qué así (los tres intentos anteriores)

- **v1 — por vet, automático.** El login con Google pedía el scope de calendario y `/auth/callback`
  guardaba el token sin que nadie lo pidiera. El *pull* trajo el calendario **personal** de un vet a
  la agenda de la clínica: **11.695 filas** "Comer"/"Trabajo"/"Dormir" contra 3 citas reales, que
  siguen hoy en la base de la clínica de prueba.
- **v2 — una cuenta por clínica (`0048`).** Acotó a la cuenta del admin pero mantuvo el
  automatismo, y apareció el segundo defecto: `session.provider_refresh_token` es el token del
  proveedor con el que se inició **sesión**, no el del botón que se apretó, y nadie lo verificaba.
  Un token de Microsoft quedó guardado en la fila de Google (medido: ambas filas con prefijo `M.C`
  y largo 417 idéntico) y Google lo rechazaba con `invalid_grant` días después, sin señalar la causa.

- **v3 — por veterinario.** Sonaba bien y en la práctica no lo era: el evento aparecía en el
  calendario del vet asignado y el **administrador** —que es quien agenda y quien mira la agenda de
  la clínica— no lo veía en ningún lado. Se reportó como "no crea nada" cuando sí creaba, en un
  calendario que la persona que agendó no tenía a la vista. Y si el vet nunca conectaba el suyo, la
  cita no llegaba a ningún calendario.

- **v4 — un calendario por clínica, el del administrador.** Conservó de v3 lo que resolvió de verdad
  —sin *pull* y sin vinculación automática— y devolvió el calendario a la clínica, que es donde el
  administrador puede verlo. Pero dejó al veterinario sin agenda propia: la única forma de que la
  viera era la invitación por correo, y **conectar su calendario no hacía absolutamente nada**, así
  que el formulario ni se le mostraba.

**v5 corrige el falso dilema de v3 y v4**, que era elegir entre el calendario del vet y el del
administrador. No hace falta elegir: el evento se crea en el del vet asignado **y** los
administradores van invitados, así que ninguno de los dos pierde de vista nada. Lo que hacía fallar a
v3 no era dónde vivía el evento — era que el admin no estaba en la lista de invitados.

> **La basura de v1 se limpió el 2026-08-03**: 19.649 filas ("Trabajo", "Comer", "Dormir", reuniones)
> contra 21 citas reales. Se identificaron por lo que la app no puede producir desde `0048` —sin
> paciente, sin titular, sin veterinario y sin autor, pero con id de evento de Google— y quedaron
> respaldadas en `appointments_importadas_respaldo`, que se puede borrar cuando ya no haga falta.

## Modelo de datos

- **`public.appointments`** (esquema base): `clinic_id, patient_id, owner_id, vet_id, title, reason,
  status, starts_at, ends_at, google_event_id, microsoft_event_id, calendar_owner_id, notes,
  created_by`. Enum `appointment_status`:
  `scheduled|confirmed|in_progress|completed|canceled|no_show`. RLS por `private.my_clinic_id()`.
  - `google_event_id` / `microsoft_event_id` (`0042`/`0043`/`0047`) — id remoto del evento.
  - `calendar_owner_id` (`0049`) — **en el calendario de quién** vive ese evento. Sin esto, al
    cambiar el veterinario asignado el evento viejo quedaba de fantasma en la agenda del anterior,
    sin forma de encontrarlo para borrarlo. Con v5 esta columna pasó a moverse seguido —el anfitrión
    cambia al reasignar la cita, y también el día que el vet conecta su calendario y la cita deja de
    caer en el del admin— así que la mudanza (borrar allá, crear acá) es el caso normal, no el raro.
  - `created_by` (esquema base) — **quién agendó**. Estaba sin usar; desde v5 va invitado.
- **`public.clinics.address` / `.city`** (esquema base): la **dirección**, que se adjunta a cada
  evento. Las columnas existían desde el principio y no había dónde cargarlas: el formulario está en
  Configuración → Clínica, y lo edita sólo un admin (policy `clinics_update`, que ya lo exigía). **No
  hizo falta migración.**
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
- `src/components/calendar/aviso-conectar-calendario.tsx` — **la ventana que le pide el calendario a
  quien no lo conectó**, al entrar a la agenda. Se cierra, y "Ahora no" la calla por el resto del
  día. El botón va directo al consentimiento y vuelve a la agenda, no a Integraciones: nadie va a
  Integraciones a resolver un problema que no sabe que tiene.
- `src/components/settings/calendar-settings.tsx` — **conectar/desconectar**, para los dos roles
  (vive en Integraciones).
- `src/components/settings/conectar-calendario.ts` — el camino de conexión compartido por los dos
  lugares que lo piden. Copiarlo era garantizar que uno de los dos mandara mal la ruta de vuelta.
- `src/components/settings/direccion-de-la-clinica.tsx` — la dirección, en Configuración.
- `src/components/patient/patient-appointments.tsx` — las citas en la ficha del paciente.
- `src/lib/agenda/destinatarios.ts` (PURO, con tests) — quién hospeda y quién va invitado. Vive
  aparte de `composio/calendario.ts` porque es la regla del modelo, no una consulta: se puede probar
  sin red, igual que `huecos.ts` y `horario-de-cada-quien.ts`.
- `src/lib/ruta-de-vuelta.ts` (PURO, con tests) — el saneado de la ruta a la que vuelve el navegador
  después del consentimiento. Es una guarda contra **redirección abierta**: la cadena llega del
  cliente y termina en un redirect al que se llega justo después de autorizar el calendario.
- `src/lib/composio/calendario.ts` (SOLO servidor) — conectar, estado, empujar y borrar, para los
  dos proveedores. Los adaptadores traducen a las tools de cada uno.
- Rutas: `src/app/api/composio/calendario/{connect,disconnect}` y
  `src/app/api/calendario/{push,delete}`. **Una sola ruta de push/delete**: qué proveedor recibe el
  evento lo resuelve el servidor. Antes había una por proveedor y el navegador llamaba a las dos sin
  saber cuál servía.

## Activación (config externa, una vez)

**Composio** — `COMPOSIO_API_KEY` (con permiso de **escritura** sobre `connected_accounts`) y el
auth config de cada proveedor: `COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID` para Google y
`COMPOSIO_OUTLOOK_AUTH_CONFIG_ID` para Outlook. No hay credenciales OAuth propias que mantener ni
tokens nuestros que guardar.

**Outlook Calendar y el correo de Outlook son el MISMO toolkit y la misma cuenta conectada.** Una
conexión sirve para los dos, y desconectar una cosa desconecta la otra — la pantalla lo advierte
antes de que alguien lo descubra por las malas. Por eso tampoco hay un auth config aparte para el
calendario de Outlook.

Si alguien tiene los dos calendarios conectados, **manda Google**: conectarlo es un acto explícito
para el calendario, mientras que la cuenta de Outlook puede existir sólo porque se conectó el correo,
y mandarle las citas ahí sería elegir un calendario que nadie pidió.

Con eso desaparecen tres problemas que el camino anterior tenía y que están documentados abajo por si
alguien piensa en volver: el `invalid_client` por credenciales que no coinciden con las de Supabase
Auth, el `invalid_grant` semanal del modo Testing, y —el peor— que
`session.provider_refresh_token` es el token del proveedor con el que se **inició sesión**, no el del
botón que se apretó: alguien entró con Microsoft y su token quedó guardado en la fila de Google.

> **Modo Testing de Google** — ya no aplica a Tuvetia: la app de Google es la de Composio, no la
> nuestra. Queda anotado porque sigue valiendo para Outlook y para cualquier vuelta atrás: mientras
> una app propia no esté publicada, los refresh token **vencen a los 7 días**.

> **Pendiente de probar con una conexión real:** de qué campo sale el id del evento creado. Composio
> **no declara** la forma de la respuesta de `GOOGLECALENDAR_CREATE_EVENT` (su esquema de salida
> viene vacío), así que se leen las variantes plausibles. Si ninguna aparece, `empujarCita` **falla
> ruidosamente** en vez de guardar null: una cita sin referencia al evento haría que la próxima
> edición creara un duplicado en el calendario en lugar de actualizar el que ya existe.

> **Pendiente de probar con una conexión real (v5): el parámetro `location`.** El resto de los
> nombres de parámetros de esta capa salió de consultar la API el 2026-08-03; éste no. Por eso la
> dirección se manda **también en el cuerpo** del evento (`Dirección: …`): si algún proveedor
> ignorara `location`, al titular le llega igual. Cuando se verifique contra una cuenta real, si
> `location` funciona en los dos, se puede evaluar quitar la línea del cuerpo — hoy aparece dos
> veces, que es el precio de no perderla.

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
- Manual (requiere las credenciales cargadas): Integraciones → conectar Google → crear una cita
  asignada a ese vet → el evento aparece **en su calendario** con el titular invitado → cambiar el
  veterinario → el evento se va del calendario del primero y aparece en el del segundo → borrar la
  cita → desaparece. Confirmar que **nada** del calendario personal entra a Tuvetia, y que el login
  con Google ya **no** pide permiso de calendario.
- Manual de v5, lo que agrega:
  1. **Un vet (no admin) conecta el suyo** desde Integraciones — el formulario tiene que estar ahí,
     no sólo para el administrador.
  2. Entrar a **Agenda sin calendario conectado** → aparece la ventana → "Ahora no" la cierra y no
     vuelve en el resto del día (vuelve mañana, o borrando `tuvetia:aviso-calendario-pospuesto` de
     `localStorage`) → el botón **Conectar** lleva al consentimiento y **vuelve a la agenda**.
  3. Crear una cita asignada a ese vet → el evento está **en su calendario**, y a **cada
     administrador** le llegó la invitación, además de al titular y a quien la agendó.
  4. Cargar la **dirección** en Configuración → Clínica → la cita nueva sale con esa ubicación (y
     con la línea `Dirección:` en el cuerpo).
  5. Cita asignada a un vet **sin** calendario conectado → cae en el del administrador. Cuando ese
     vet conecta el suyo y se vuelve a guardar la cita, el evento se **muda**: desaparece del
     calendario del admin y aparece en el del vet.

## Pendientes

- ~~Sync por-vet vs. calendario de clínica~~ — cerrado en v3: por usuario, explícito, una sola vía.
- **Las 11.695 citas basura de v1** siguen en la base de la clínica de prueba. No se borraron por
  decisión del usuario; se limpian con un `delete` sobre las filas con `google_event_id` no nulo y
  paciente/titular/vet en `NULL`.
- **Titular sin correo**: no se lo invita (la cita se crea igual). Si se quiere exigir el correo
  para agendar, hay que pedirlo antes en el alta del titular.

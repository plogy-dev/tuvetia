# Referencia de API

Las **22 rutas** de `src/app/api/`, con su método, cómo se autentican y qué hacen. Los endpoints del
backend Athos son otra cosa y están en
[`athos-service/CLAUDE.md`](../athos-service/CLAUDE.md) §Endpoints.

## Cómo leer la columna de autenticación

| | Qué significa |
|---|---|
| **sesión del vet** | `auth.getUser()`; sin sesión → `401`. La RLS acota a su clínica |
| **`CRON_SECRET`** | Header `Authorization: Bearer $CRON_SECRET`. **Sin la variable devuelve `503`**, no queda abierta |
| **firma / token de webhook** | Lo llama un tercero (Meta, Evolution), no un usuario: se valida la firma o un token secreto |
| **token en la URL** | El propio token del recurso hace de credencial (feeds de calendario) |

La columna **`service_role`** marca las rutas que usan el cliente que **se salta la RLS**. En todas
ellas el `clinic_id` va explícito, porque no hay quien las acote: es la regla que hace segura esa
elevación de permisos.

---

## Athos (agente y aprobación de acciones)

| Ruta | Método | Auth | `service_role` | Qué hace |
|---|---|---|---|---|
| `/api/athos/agent` | POST | sesión | — | El chat agéntico de `/dashboard/asistente`. Corre el loop del AI SDK con las 17 tools, hasta 8 pasos. Límite: 30 peticiones/min por usuario |
| `/api/athos/suggest-reply` | POST | sesión | — | Redacta una respuesta de WhatsApp para la bandeja. Devuelve `{draft, action_id}`: **no envía**, propone. Límite: 15/min |
| `/api/athos/actions/[id]/execute` | POST | sesión | sí | Aprueba y **ejecuta** una acción propuesta. Corre con la sesión del vet aprobador. Acepta `payload_override` para editar antes de aprobar. `409` si ya fue procesada, `410` si expiró |
| `/api/athos/actions/[id]/reject` | POST | sesión | sí | Rechaza una propuesta. Compare-and-set: `409` si ya cambió de estado |

**Detalle de `execute`:** lee la acción con la sesión (si es de otra clínica, la RLS la hace
invisible → `404`), reserva atómicamente `proposed → approved` para que un doble clic no ejecute dos
veces, despacha, y registra el resultado en `athos_actions` y en `audit_logs`.

## Comunicaciones — WhatsApp

| Ruta | Método | Auth | `service_role` | Qué hace |
|---|---|---|---|---|
| `/api/whatsapp/send` | POST | sesión | — | Envía un mensaje por el proveedor configurado de la clínica |
| `/api/whatsapp/status` | POST | sesión | sí | Estado de la conexión de la clínica |
| `/api/whatsapp/connect` | POST | sesión | sí | Inicia la conexión vía Kapso. ⚠️ Devuelve una `setup_url` **externa**: saca al usuario de la plataforma |
| `/api/whatsapp/exchange` | POST | sesión | sí | Canjea el código del *Embedded Signup* de Meta por el token de la clínica (cifrado con `WHATSAPP_TOKEN_KEY`) |
| `/api/whatsapp/evolution/connect` | POST | sesión | sí | Crea la instancia de Evolution y devuelve el QR para mostrarlo **dentro** de la app |
| `/api/whatsapp/agent-mode` | POST | sesión | sí | Cambia entre `review` (el vet aprueba) y `auto` (responde solo) |
| `/api/whatsapp/webhook` | GET, POST | firma HMAC de Meta · secreto de Kapso · verify token | sí | Recibe entrantes y estados. `GET` es el *challenge* de Meta. Idempotente por `wa_message_id` |
| `/api/whatsapp/evolution/webhook/[token]` | POST | token en la URL | sí | Entrantes de Evolution. ⚠️ Evolution **no firma** los mensajes: la única credencial es el token |

Los dos webhooks convergen en `routeInbound` (`src/lib/whatsapp/inbound-router.ts`), que es el
**punto único de entrada**: primero ofrece el mensaje al motor de cartera y, si no lo reclama, al
asistente clínico.

## Calendario

| Ruta | Método | Auth | Qué hace |
|---|---|---|---|
| `/api/google/calendar/connect` | POST | sesión | Guarda el token de Google del veterinario (opt-in) |
| `/api/google/calendar/push` | POST | sesión | Envía una cita a Google |
| `/api/google/calendar/delete` | POST | sesión | Borra la cita en Google |
| `/api/google/calendar/sync` | POST | sesión | Trae los cambios de Google. ⚠️ **Sólo al pulsar "Sincronizar"**: no hay suscripción de cambios ni tarea programada |
| `/api/calendar/ics/[token]` | GET | token en la URL | Feed ICS de sólo lectura, para suscribirse desde cualquier calendario |

⚠️ **Hueco conocido:** las citas que crea el agente de Athos **no se envían a Google** — el ejecutor
de acciones no invoca el push.

## Equipo y datos

| Ruta | Método | Auth | `service_role` | Qué hace |
|---|---|---|---|---|
| `/api/team/invite-email` | POST | sesión (**sólo admin**) | sí | Manda el correo de invitación. `redirectTo` apunta a `/auth/callback?next=/invitar/<token>` — tiene que ser esa ruta, porque es la que canjea el código |
| `/api/onboarding/demo-data` | POST, DELETE | sesión | sí | Siembra y borra datos de ejemplo. El `DELETE` los identifica por el marcador del titular: no lo renombres o quedan huérfanos |
| `/api/export` | GET | sesión | — | Exporta los datos de la clínica |

## Tareas programadas

| Ruta | Método | Auth | Schedule | Qué hace |
|---|---|---|---|---|
| `/api/cron/purge-audio` | GET | `CRON_SECRET` | `0 3 * * *` | Borra el audio de consultas con más de 4 días. **Es la retención de la Ley 1581** |
| `/api/cron/cartera` | GET | `CRON_SECRET` | `0 14 * * *` (9:00 Colombia) | Barrido de cobranza con los límites de la Ley 2300 |

Declaradas en `vercel.json`. El plan Hobby permite 2 crons de disparo diario, que son justo los dos.

> 🔴 **Sin `CRON_SECRET` en Vercel las dos devuelven `503`**, y con la purga caída **se incumple la
> retención de audio en silencio**. Falla cerrado a propósito: es mejor no correr que correr sin
> autenticar, pero hay que configurar la variable.

El barrido de cartera fija `process.env.TZ = "America/Bogota"` y **aborta** si el offset no es el
esperado: sin eso, la ventana legal de 7:00–19:00 se leía en UTC y permitía cobrar a las 3 de la
mañana.

---

## Convenciones de estas rutas

- **`runtime = "nodejs"`** donde se necesita el SDK de Supabase o `crypto`.
- **Errores en JSON** con el código HTTP correcto: `{ error: "…" }`. Los mensajes están en español
  porque varios se muestran tal cual al veterinario.
- **`409` para conflictos de estado** (una acción ya procesada) y **`410`** para propuestas expiradas:
  el front distingue "recargá" de "pedí una nueva".
- **Los webhooks nunca devuelven 5xx por un error de negocio**: si respondieran error, el proveedor
  reintentaría y duplicaría el mensaje.
- **`after()`** para el trabajo posterior a la respuesta (enrutar un entrante), de modo que el
  proveedor reciba su `200` sin esperar.

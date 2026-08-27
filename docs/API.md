# Referencia de API

Las **41 rutas** de `src/app/api/` y las **3** de `src/app/auth/`, con su método, cómo se autentican
y qué hacen. Los endpoints del backend Athos son otra cosa y están en
[`athos-service/CLAUDE.md`](../athos-service/CLAUDE.md) §Endpoints.

> **Inventario verificado contra el repo el 2026-08-27** (`src/app/api/**/route.ts` y
> `src/app/auth/**/route.ts`). Antes este documento declaraba **22** rutas y describía cuatro
> `/api/google/calendar/*` que **ya no existen**: el calendario pasó a Composio y las rutas de hoy
> son `/api/composio/calendario/*` y `/api/calendario/*`. Si venís de la versión anterior, ése es el
> cambio que más sorprende.

## Cómo leer la columna de autenticación

| | Qué significa |
|---|---|
| **sesión del vet** | `auth.getUser()`; sin sesión → `401`. La RLS acota a su clínica |
| **`CRON_SECRET`** | Header `Authorization: Bearer $CRON_SECRET`. **Sin la variable devuelve `503`**, no queda abierta |
| **firma / token de webhook** | Lo llama un tercero (Meta, Evolution, Wompi), no un usuario: se valida la firma o un token secreto |
| **token en la URL** | El propio token del recurso hace de credencial (feeds de calendario) |

La columna **`service_role`** marca las rutas que usan el cliente que **se salta la RLS**. En todas
ellas el `clinic_id` va explícito, porque no hay quien las acote: es la regla que hace segura esa
elevación de permisos.

---

## Athos (agente, aprobación de acciones y superficies de IA)

| Ruta | Método | Auth | `service_role` | Qué hace |
|---|---|---|---|---|
| `/api/athos/agent` | POST | sesión | — | El chat agéntico de `/dashboard/asistente`. Corre el loop del AI SDK con las **23 tools** de `buildAthosTools`, hasta 8 pasos (`stepCountIs(8)`) y 6000 tokens de salida **por paso**. Límite: 30 peticiones/min por usuario |
| `/api/athos/suggest-reply` | POST | sesión | — | Redacta una respuesta de WhatsApp para la bandeja. Devuelve `{draft, action_id}`: **no envía**, propone. Hasta 5 pasos. Límite: 15/min |
| `/api/athos/actions/[id]/execute` | POST | sesión | sí | Aprueba y **ejecuta** una acción propuesta. Corre con la sesión del vet aprobador. Acepta `payload_override` para editar antes de aprobar. `409` si ya fue procesada, `410` si expiró |
| `/api/athos/actions/[id]/reject` | POST | sesión | sí | Rechaza una propuesta. Compare-and-set: `409` si ya cambió de estado |
| `/api/athos/live` | POST | sesión | — | La inteligencia en vivo del Modo Fantasma, **en vez de llamar al microservicio directo**. Reenvía el JWT del vet a `/athos/live`; el `clinic_id` del cupo sale de la sesión, no del cuerpo. Exige plan Pro (capacidad `athos`) y `503` si falta `NEXT_PUBLIC_ATHOS_URL` |
| `/api/athos/casos-parecidos` | POST | sesión | — | Consultas ANTERIORES de la clínica parecidas a la que está pasando ("esto ya lo viste en marzo"). **No gasta cupo de IA**: saca los términos distintivos de la transcripción y busca sobre las notas ya escritas. Tope 5 |
| `/api/athos/leer-documento` | POST | sesión | — | Fase 2 de los adjuntos del chat: lee con el modelo de visión un PDF **escaneado** o una imagen de un documento. Tope 25 páginas. El documento se paga una sola vez, al adjuntarlo |
| `/api/athos/chats/ocultar` | POST | sesión | sí | Elimina un chat **de la vista**: marca `hidden_at` en los mensajes del hilo, no borra nada. `restaurar` es el "Deshacer" del toast, y usa la marca del ocultado para no resucitar los anteriores. Límite: 30/min |

**Detalle de `execute`:** lee la acción con la sesión (si es de otra clínica, la RLS la hace
invisible → `404`), reserva atómicamente `proposed → approved` para que un doble clic no ejecute dos
veces, despacha, y registra el resultado en `athos_actions` y en `audit_logs`.

**Por qué `live` pasa por Next y no va directo al microservicio:** el tope mensual por clínica vive
en `athos_agent_usage`, del lado de Next. Un gasto que no pasa por acá no se cuenta — y es justo el
que más hay que contar, porque se dispara solo, decenas de veces por consulta, mientras el
veterinario atiende.

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

## Comunicaciones — Correo

| Ruta | Método | Auth | Qué hace |
|---|---|---|---|
| `/api/composio/correo/connect` | GET | pública | Qué proveedores de correo puede ofrecer este despliegue — lo consulta la tarjeta del chat |
| `/api/composio/correo/connect` | POST | sesión | Empieza la conexión del correo **del miembro que la pide** (Gmail u Outlook) y devuelve la URL de autorización. El token queda del lado de Composio y nunca pasa por acá |
| `/api/composio/correo/disconnect` | POST | sesión | Borra la cuenta del lado de Composio: Athos deja de poder leer o escribir por él. Lo ya enviado queda donde está |
| `/api/email/reply` | POST | sesión | Responde desde la bandeja, **con la cuenta del propio veterinario**. El `thread_id` es lo que hace que la respuesta quede DENTRO del hilo en vez de abrir uno nuevo |

El `volverA` del `connect` se sanea a rutas internas del dashboard: viene del cliente, y una URL
absoluta ahí sería un redirect abierto con la app de trampolín.

## Calendario

| Ruta | Método | Auth | `service_role` | Qué hace |
|---|---|---|---|---|
| `/api/composio/calendario/connect` | GET | pública | — | Qué calendarios puede ofrecer este despliegue |
| `/api/composio/calendario/connect` | POST | sesión | — | Empieza la conexión del calendario **del veterinario que la pide** y devuelve la URL de autorización. Reemplaza al camino viejo por OAuth de Supabase, que guardaba el token del proveedor con el que se INICIÓ SESIÓN y no el del botón apretado |
| `/api/composio/calendario/disconnect` | POST | sesión | — | Desconecta el calendario. Las citas ya empujadas **quedan** en su calendario: sacarlas sería borrarle eventos que nunca pidió borrar |
| `/api/calendario/push` | POST | sesión | sí (en `empujarCita`) | Crea o actualiza el evento en el calendario del **veterinario asignado** (o el administrador de respaldo), invitando al titular y al equipo. **Una sola ruta para los dos proveedores**: quién hospeda el evento lo decide el servidor. Devuelve `motivo` cuando la cita no llegó, para que el front pueda decir por qué |
| `/api/calendario/delete` | POST | sesión | — | Borra el evento remoto al eliminar una cita. Recibe el **`appointment_id`, no el id del evento**: los dos ids salen de la fila leída con la sesión. Se llama **antes** de borrar la fila |
| `/api/calendar/ics/[token]` | GET | token en la URL | sí | Feed ICS de sólo lectura, para suscribirse desde cualquier calendario |

⚠️ **Por qué `delete` recibe la cita y no el evento:** antes recibía el id del evento y el dueño
desde el navegador, y sólo validaba que el dueño fuera de la misma clínica. Nada ataba ese evento a
ninguna cita, así que cualquier miembro autenticado podía mandar el id de un evento del calendario
**personal** de un colega y Tuvetia se lo borraba, notificando a los invitados.

⚠️ **Hueco conocido:** las citas que crea el agente de Athos **no se envían al calendario** — el
ejecutor de acciones no invoca el push.

## Citas e informe al titular

| Ruta | Método | Auth | `service_role` | Qué hace |
|---|---|---|---|---|
| `/api/citas/confirmar` | POST | sesión | sí (en `confirmarCita`) | Le avisa al titular por WhatsApp que su cita quedó agendada. **La clínica sale de la sesión y nunca del cuerpo**: si viniera del navegador, cualquiera con sesión podría pedir la confirmación de una cita ajena y ver a qué número salió. Devuelve el motivo cuando no salió |
| `/api/informe-al-titular` | POST | sesión | — | Redacta el **borrador** del informe que se lleva el dueño. Tres guardas antes de gastar un token: sesión, **nota aprobada** (regla 5, también impuesta por trigger en la `0071`) y cupo. **No guarda nada** |
| `/api/informe-al-titular/whatsapp` | POST | sesión | — | Manda el informe **ya editado por el vet** por WhatsApp y registra la entrega, las dos cosas acá. El teléfono se resuelve en el servidor (consulta → paciente → titular), nunca llega en el body |

**La regla que estas rutas no pueden romper:** lo clínico nunca sale solo. El clic de "Enviar por
WhatsApp" **es** la aprobación; no hay camino automático hacia ese endpoint. El registro se hace en
el servidor porque la entrega pasa en el servidor: si quedara del lado del navegador, un tab cerrado
entre el envío y el insert dejaría un WhatsApp mandado sin fila de auditoría.

## Suscripción y cobros (Wompi)

| Ruta | Método | Auth | `service_role` | Qué hace |
|---|---|---|---|---|
| `/api/suscripcion/iniciar` | GET | sesión (**sólo admin**) | — | Los tokens de aceptación de términos que Wompi exige antes de guardar una tarjeta. Son de vida corta: se piden al abrir el formulario, no al cargar la app |
| `/api/suscripcion/suscribir` | POST | sesión (**sólo admin**) | sí | El alta. **Lo que entra no es una tarjeta**, es un token que el navegador consiguió hablando con Wompi directo. Tres pasos: crear la fuente de pago → **guardarla en la base aunque el cobro no haya salido** → cobrar el primer período |
| `/api/suscripcion/cancelar` | POST | sesión (**sólo admin**) | — | Cancela la renovación. **No baja el plan en el acto** ni borra la tarjeta: el barrido baja la clínica cuando termina el período ya pagado |
| `/api/wompi/webhook` | POST | firma (checksum de Wompi) | sí | **La única fuente de verdad sobre si un pago salió.** `POST /transactions` responde `PENDING` casi siempre, y la redirección del navegador no sirve como prueba |

> 🔴 **El plan no se activa al suscribirse: lo activa el webhook.** Dar el `PENDING` por aprobado
> sería regalar el mes cada vez que un banco rechace después.

Notas del webhook, que explican dos decisiones que parecen errores:

- **La URL es pública** — Wompi no manda credenciales. Lo que la protege es el checksum, y por eso
  **un evento sin firma válida se guarda pero no se aplica**. Sin esa regla, cualquiera que conozca
  la URL se regalaría el plan Pro mandando un JSON con `status: APPROVED`.
- **Siempre `200`, incluso al rechazar** — Wompi reintenta ante cualquier respuesta que no sea 2xx.
  Lo que pasó queda en `suscripcion_eventos`. La única excepción es un cuerpo que ni siquiera es
  JSON: ahí sí `400`, porque no hay nada que registrar.

## Equipo, datos y tablero

| Ruta | Método | Auth | `service_role` | Qué hace |
|---|---|---|---|---|
| `/api/team/invite-email` | POST | sesión (**sólo admin**) | sí | Manda el correo de invitación. `redirectTo` apunta a `/auth/callback?next=/invitar/<token>` — tiene que ser esa ruta, porque es la que canjea el código |
| `/api/onboarding/demo-data` | POST, DELETE | sesión | sí | Siembra y borra datos de ejemplo. El `DELETE` los identifica por el marcador del titular: no lo renombres o quedan huérfanos |
| `/api/export` | GET | sesión | — | Exporta los datos de la clínica como JSON abierto (10 tablas, `format: tuvetia-export-v1`). Respalda la promesa de no-lock-in. **Con el cliente del usuario**: la RLS decide qué sale |
| `/api/facturacion/inventario/export` | GET | sesión | — | Baja el inventario a Excel. Es una ruta y no una server action porque el resultado es un **archivo** (`Content-Disposition`), y así el botón es un `<a href>` común. Incluye lo inactivo a propósito |
| `/api/tablero/detalle` | GET | sesión | — | El detalle de una pastilla del tablero (`?metrica=`), sin salir del tablero. Tope 8 filas. Se pide **al abrir**, no con el tablero: son listas que casi nunca se miran |

Los filtros de cada métrica de `/api/tablero/detalle` son **los mismos** que los del conteo, para
que el detalle no contradiga a la cifra que lo abrió.

## Tareas programadas y operación

| Ruta | Método | Auth | Disparo | Qué hace |
|---|---|---|---|---|
| `/api/cron/purge-audio` | GET | `CRON_SECRET` | `vercel.json`, `0 3 * * *` | Borra el audio de consultas con más de 4 días. **Es la retención de la Ley 1581** |
| `/api/cron/cartera` | GET | `CRON_SECRET` | GitHub Action (`*/15 12-23 * * *` UTC) + `vercel.json` `0 14 * * *` de respaldo | Barrido de cobranza con los límites de la Ley 2300. **También corre el barrido diario de suscripciones** |
| `/api/cron/briefing` | GET | `CRON_SECRET` | GitHub Action | El briefing diario de cada clínica. Idempotente: `clinic_briefings` tiene `unique (clinic_id, fecha)` y la guarda se consulta **antes** de armar el pedido, así que un segundo disparo no gasta |
| `/api/cron/suscripciones` | GET | `CRON_SECRET` | **a mano** | Barrido de suscripciones + reconciliación de cobros colgados. Para correrlo cuando uno quiera —después de arreglar una tarjeta, al probar— sin esperar al horario |
| `/api/health` | GET | `CRON_SECRET` | — | Chequeo de configuración del despliegue: **qué está cableado, nunca con qué valor**. Sólo booleanos |

**Sólo dos están en `vercel.json`**, y no por casualidad: el plan Hobby permite dos crons de disparo
diario y los dos cupos están usados. Por eso el briefing lo llama una GitHub Action y el barrido de
suscripciones vive dentro del cron de cartera.

⚠️ **A cartera no la manda el cron de Vercel, aunque figure ahí.** Quien la dispara de verdad es
`.github/workflows/cartera-sweep.yml`, dentro de la ventana `12-23` UTC — o sea que el primer
barrido del día sale cerca de las **7:00 de Colombia, no a las 9:00** que sugiere el `0 14 * * *`.
Existe porque con un solo disparo diario una respuesta por correo del cliente se procesaba una vez
al día; el cron de Vercel quedó como respaldo, porque los schedules de Actions no tienen SLA y se
desactivan solos en repos sin actividad. **Ese `*/15` es el piso pedido, no una cadencia
garantizada**: el 2026-07-30 GitHub disparó ~1 vez cada 80 minutos donde tocaban ~32. Que la hora
real sea 7:00 y no 9:00 no rompe la Ley 2300 — la ventana legal (7–19) la impone el gate del código,
no el disparador.

> 🔴 **Sin `CRON_SECRET` las cinco devuelven `503`**, y con la purga caída **se incumple la
> retención de audio en silencio**. Falla cerrado a propósito: es mejor no correr que correr sin
> autenticar, pero hay que configurar la variable. La variante permisiva (`if (secret && …)`) deja
> el endpoint **abierto** justo cuando la variable falta, que es cuando menos te enterás.

El barrido de cartera fija `process.env.TZ = "America/Bogota"` y **aborta** si el offset no es el
esperado: sin eso, la ventana legal de 7:00–19:00 se leía en UTC y permitía cobrar a las 3 de la
mañana.

`/api/health` está protegido con el mismo secreto que los crons porque saber qué integraciones tiene
una clínica es información útil para un atacante. Nació de la auditoría del Milestone 2, que
encontró variables faltantes apagando funciones enteras **en silencio**: sin `RESEND_API_KEY` el
endpoint respondía `ok: true` con las facturas sin salir.

## Autenticación (`src/app/auth/`)

No cuelgan de `/api` porque son destinos de redirección del navegador, no endpoints de datos.

| Ruta | Método | Auth | Qué hace |
|---|---|---|---|
| `/auth/callback` | GET | el `?code=` de OAuth | Atiende el retorno del login con Google (PKCE). **Sin `code` no es un error todavía**: puede ser un enlace de correo, que trae los tokens en el fragmento — y el fragmento no viaja al servidor. Deriva a `/auth/sesion`, que corre en el navegador y sí puede leerlo |
| `/auth/confirm` | GET | `token_hash` + `type` | Verifica el magic link con `verifyOtp`. Si falla, manda al login con el **motivo real** (`otp_expired`, etc.) para que el usuario sepa qué pasó |
| `/auth/signout` | POST | sesión | Cierra la sesión y redirige (`303`). **Es POST a propósito**: con GET, el prefetch de `<Link>` de Next cerraría la sesión con sólo pasar el mouse por encima |

⚠️ **`/auth/callback` no vincula ningún calendario** (calendario v3, migración `0049`). Antes
guardaba el `provider_refresh_token` del login como integración, sin que nadie lo pidiera: el
calendario **personal** del vet terminaba sincronizado con la agenda de la clínica, y un token de
Microsoft podía quedar guardado en la fila de Google.

Las dos rutas `GET` sanean el `?next=` con `safeNext` — sólo destinos internos, para que no sirvan
de trampolín a un redirect abierto.

---

## Convenciones de estas rutas

- **`runtime = "nodejs"`** donde se necesita el SDK de Supabase o `crypto`.
- **`dynamic = "force-dynamic"`** donde la respuesta refleja el estado del proceso vivo o una sesión
  (`health`, las de suscripción): cachearlas sería responder con la configuración de ayer.
- **Errores en JSON** con el código HTTP correcto: `{ error: "…" }`. Los mensajes están en español
  porque varios se muestran tal cual al veterinario.
- **`409` para conflictos de estado** (una acción ya procesada) y **`410`** para propuestas expiradas:
  el front distingue "recargá" de "pedí una nueva".
- **`402` para las dos formas de "no podés gastar"** (`requiereCapacidad` en
  `src/lib/api/clinica-de-la-sesion.ts` y el tope mensual). Las distingue la cabecera
  **`X-Requiere-Plan: pro`** (+ `X-Capacidad`), que sólo lleva el primero: "tu plan no lo incluye"
  se arregla mejorando el plan y el front ofrece la mejora, "se te acabó el cupo del mes" se
  arregla esperando. Sin esa cabecera el front tendría un solo `402` y ofrecería Pro a quien ya lo
  tiene.
- **Los webhooks nunca devuelven 5xx por un error de negocio**: si respondieran error, el proveedor
  reintentaría y duplicaría el mensaje (o el cobro).
- **La clínica sale siempre de la sesión, nunca del cuerpo del pedido.** Es la regla que sostiene
  todas las rutas con `service_role`, y varias la explican en su cabecera porque es donde se rompe.
- **`after()`** para el trabajo posterior a la respuesta (enrutar un entrante), de modo que el
  proveedor reciba su `200` sin esperar.

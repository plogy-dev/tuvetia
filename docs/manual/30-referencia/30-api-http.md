---
titulo: Rutas HTTP
seccion: referencia
orden: 30
resumen: Las 37 rutas de /api — método, qué autentica cada una y qué hace. Incluye webhooks y crons.
---

# Rutas HTTP

Todas viven en `src/app/api/`. La tabla dice **cómo se autentica cada una**, que es el dato que más
importa: hay tres formas distintas y confundirlas es cómo se abren agujeros.

## Las tres formas de autenticar

| Forma | Cuáles | Cómo |
|---|---|---|
| **Sesión** | La mayoría | `supabase.auth.getUser()` y RLS. Si no hay sesión, `401` |
| **Secreto compartido** | Los crons | Cabecera con `CRON_SECRET`. Sin la variable, `503` |
| **Firma o token del proveedor** | Los webhooks | Firma de Meta / Wompi, o token secreto en la URL (Evolution) |
| **Token en la URL** | ICS, informe al titular, baja | El token *es* la credencial. No hay sesión |

---

## Athos — el agente

| Ruta | Método | Auth | Qué hace |
|---|---|---|---|
| `/api/athos/agent` | POST | sesión | El chat con herramientas. Devuelve stream |
| `/api/athos/live` | POST | sesión | El Modo Fantasma en vivo |
| `/api/athos/suggest-reply` | POST | sesión | Sugiere la respuesta de un WhatsApp |
| `/api/athos/casos-parecidos` | POST | sesión | Casos similares. Corre **con la sesión del vet**, no con `service_role`: la RLS es lo que garantiza que no vea otra clínica |
| `/api/athos/actions/[id]/execute` | POST | sesión | **Ejecuta una acción aprobada.** La ruta más delicada del producto |
| `/api/athos/actions/[id]/reject` | POST | sesión | Rechaza una acción propuesta |

### Sobre `execute`

Manda WhatsApps y correos reales, crea citas y escribe en la historia clínica. Tiene cuatro guardas
que conviene conocer antes de tocarla:

1. **Reserva atómica.** El chequeo de estado es un TOCTOU: entre leer y ejecutar puede colarse otra
   petición (doble clic en "Aprobar"). Un `UPDATE` condicional deja que sólo **una** transición
   `proposed → approved` gane; la perdedora ve `409`.
2. **Revalidación del payload.** El vet puede editar la propuesta antes de aprobarla, y entre
   proponer y ejecutar el payload sale del servidor y vuelve. Se revalida contra el esquema, y el
   parseo **descarta los campos desconocidos**: un `clinic_id` agregado al override no llega a la RPC.
3. **Corre bajo la sesión del vet**, no impersonando: las RPC `security definer` ven el `auth.uid()`
   real y la RLS aplica.
4. **El detalle crudo del fallo se guarda y se audita**, pero no se le muestra al vet: es lo que hace
   depurable una propuesta fallida sin filtrar la respuesta del proveedor.

---

## Calendario

| Ruta | Método | Auth | Qué hace |
|---|---|---|---|
| `/api/calendario/push` | POST | sesión | Empuja una cita al calendario. **Una sola ruta para los dos proveedores** |
| `/api/calendario/delete` | POST | sesión | Borra el evento remoto. **Se llama antes de borrar la fila** |
| `/api/composio/calendario/connect` | GET, POST | sesión | GET lista proveedores disponibles; POST inicia el consentimiento |
| `/api/composio/calendario/disconnect` | POST | sesión | Desconecta |
| `/api/calendar/ics/[token]` | GET | **token** | El feed ICS de solo lectura de la clínica |

Dos decisiones de seguridad que están escritas en el código y conviene no deshacer:

- **`delete` recibe el `appointment_id`, no el id del evento.** Antes recibía el id del evento y el
  dueño desde el navegador, y nada ataba ese evento a ninguna cita: cualquier miembro podía mandar el
  id de un evento del calendario **personal** de un colega y Tuvetia se lo borraba, notificando a los
  invitados. Ahora los dos ids salen de la fila, leída con la sesión del llamador.
- **`push` verifica que la cita exista para quien pregunta** antes de llamar a `service_role`. Sin
  ese chequeo, cualquiera podría meterle un evento en el calendario a alguien de otra clínica.

---

## Correo

| Ruta | Método | Auth | Qué hace |
|---|---|---|---|
| `/api/composio/correo/connect` | GET, POST | sesión | Conecta la cuenta personal de un miembro |
| `/api/composio/correo/disconnect` | POST | sesión | Desconecta |
| `/api/email/reply` | POST | sesión | Responde un hilo |
| `/api/informe-al-titular` | POST | sesión | Genera el informe de consulta para el titular |

---

## WhatsApp

| Ruta | Método | Auth | Qué hace |
|---|---|---|---|
| `/api/whatsapp/webhook` | GET, POST | **firma de Meta** | Recibe mensajes. GET es la verificación de Meta |
| `/api/whatsapp/evolution/webhook/[token]` | POST | **token en la URL** | Recibe de Evolution. **Evolution no firma: el token es la auth entera** |
| `/api/whatsapp/send` | POST | sesión | Envía un mensaje |
| `/api/whatsapp/connect` | POST | sesión | Inicia la conexión (Meta / Kapso) |
| `/api/whatsapp/evolution/connect` | POST | sesión | Inicia la conexión por QR |
| `/api/whatsapp/exchange` | POST | sesión | Intercambia el código del Embedded Signup |
| `/api/whatsapp/status` | POST | sesión | Estado de la conexión |
| `/api/whatsapp/agent-mode` | POST | sesión | Cambia el modo del agente (`auto`, `review`, `paused`, `intervene`) |

---

## Facturación y suscripción

| Ruta | Método | Auth | Qué hace |
|---|---|---|---|
| `/api/wompi/webhook` | POST | **firma de Wompi** | Aplica los eventos de pago. **Sin `WOMPI_EVENTS_SECRET` no aplica ninguno** |
| `/api/suscripcion/iniciar` | GET | sesión + **admin** | Arranca la contratación |
| `/api/suscripcion/suscribir` | POST | sesión + **admin** | Suscribe |
| `/api/suscripcion/cancelar` | POST | sesión + **admin** | Cancela |
| `/api/facturacion/inventario/export` | GET | — | Exporta el inventario |

Las tres de suscripción exigen rol `admin` de la clínica, no sólo sesión.

---

## Tareas programadas

| Ruta | Método | Auth | Programación |
|---|---|---|---|
| `/api/cron/purge-audio` | GET | `CRON_SECRET` | `0 3 * * *` (03:00) |
| `/api/cron/cartera` | GET | `CRON_SECRET` | `0 14 * * *` (14:00) |
| `/api/cron/briefing` | GET | `CRON_SECRET` | *no está en `vercel.json`* |
| `/api/cron/suscripciones` | GET | `CRON_SECRET` | *corre dentro del de cartera* |

**Sólo dos están programados en `vercel.json`.** El plan Hobby de Vercel permite dos crons, y los dos
están usados: por eso el barrido de suscripciones corre **dentro** del de cartera en vez de tener el
suyo. `briefing` existe como ruta pero no tiene programación propia.

Ver [Tareas programadas](60-tareas-programadas.md).

---

## Otras

| Ruta | Método | Auth | Qué hace |
|---|---|---|---|
| `/api/health` | GET | — | Qué está configurado y qué no. La forma rápida de auditar un despliegue |
| `/api/export` | GET | sesión | Exporta **todos** los datos de la clínica en JSON abierto |
| `/api/tablero/detalle` | GET | sesión | El detalle de una pastilla del tablero |
| `/api/team/invite-email` | POST | sesión + **admin** | Manda la invitación por correo |
| `/api/onboarding/demo-data` | POST, DELETE | sesión | Crea y borra datos de demostración |

### `/api/export` — sin lock-in

Devuelve pacientes, titulares, consultas, transcripciones, notas, citas y mensajes de la clínica en
JSON. Es una decisión de producto explícita: los datos son del cliente y se los puede llevar cuando
quiera.

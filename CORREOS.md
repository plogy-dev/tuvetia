# Correos de Tuvetia

Tuvetia manda y lee correo por **exactamente dos caminos**. No hay un tercero, y agregarlo es una
decisión de arquitectura, no un detalle de implementación.

| | Sale de | Lo usa | Transporte |
|---|---|---|---|
| **Transaccional** | `vet@tuvetia.com`, firmado con el nombre de la clínica | Facturas, cobranza, y las notificaciones de `/admin` a los veterinarios | **Resend** |
| **De Athos** | La cuenta Google que conectó **cada miembro** | Athos leyendo y escribiendo correo, y la bandeja de Comunicaciones | **Composio** (OAuth) |

**La regla en una línea:** si el correo lo manda *el sistema*, va por Resend; si lo manda *una
persona* (o Athos por ella), va por Composio con la cuenta de esa persona.

> **Estado:** los dos caminos están en pie y verificados contra las APIs reales. El de SMTP/IMAP por
> cuenta se retiró por completo.

---

## 1. Transaccional — la regla

**Todo correo que Tuvetia le manda a un cliente en nombre de una clínica sale así:**

```
From:      Clínica de Santiago Tellez <vet@tuvetia.com>
Reply-To:  admin@laclinica.com
```

- **Remitente:** siempre `vet@tuvetia.com` (configurable con `TRANSACTIONAL_FROM_EMAIL`).
- **Nombre visible:** el de la clínica (`clinics.name`). El cliente ve a su veterinaria, no a Tuvetia.
- **Reply-To:** los correos de los administradores de esa clínica (`profiles.role = 'admin'` →
  `auth.users.email`). Plural: si hay varios admins, van todos.

Un solo punto de entrada: [`sendTransactionalEmail`](src/lib/email/transactional.ts). Cualquier
correo nuevo de este tipo entra por ahí y hereda remitente y Reply-To sin volver a decidirlo.

```ts
import { sendTransactionalEmail } from "@/lib/email/transactional"

await sendTransactionalEmail(clinicId, {
  to: "titular@ejemplo.com",
  subject: "Recordatorio de vacuna",
  text: "…",
  messageId,          // opcional: raíz del hilo, si esperás respuesta
})
```

### Por qué no sale de la cuenta de la clínica

Era así hasta ahora, y tenía dos problemas:

1. **Entregabilidad.** Una cuenta de Gmail mandando facturas por SMTP termina en spam apenas sube el
   volumen — y ahí el cliente nunca se entera de que le cobraron. Un dominio con SPF y DKIM propios
   y reputación cuidada llega a la bandeja de entrada.
2. **Dependía de que cada clínica configurara SMTP.** En la práctica no lo hacía nadie
   (`email_integrations` estuvo en 0 filas), así que facturar por correo simplemente no funcionaba y
   la cobranza terminaba siendo sólo WhatsApp.

El Reply-To es lo que evita el efecto secundario obvio: el cliente responde y le llega a **su**
veterinaria, no a Tuvetia.

### Consecuencia a tener presente

Las respuestas de los clientes ahora caen en el buzón del **administrador**. El motor de cobranza
lee respuestas por IMAP desde la **cuenta institucional conectada en Conexiones**
([`sync.ts`](src/lib/email/sync.ts) → `invoice_email_threads`). Si el correo del admin **no** es esa
cuenta, esas respuestas no se procesan: las promesas de pago y los comprobantes que el cliente mande
por correo no llegan al motor.

No es un fallo silencioso nuevo —hoy no hay ninguna cuenta conectada, así que ese circuito nunca
corrió—, pero es lo que hay que mirar antes de encender la cobranza por correo. La forma de cerrarlo
es que el admin conecte **ese mismo** buzón en Conexiones → *Correo de la clínica*.

---

### Notificaciones de plataforma

[`platform-sender.ts`](src/lib/email/platform-sender.ts) — el envío desde `/admin/usuarios`. Va por
el mismo Resend, pero **sin** nombre de clínica ni Reply-To: acá el destinatario es el veterinario y
quien le escribe es Tuvetia. Por eso es un módulo aparte y no un parámetro de
`sendTransactionalEmail`.

---

## 2. De Athos — la cuenta de cada miembro, vía Composio

Cada miembro conecta **su** cuenta en Conexiones — **Gmail u Outlook**, uno de los dos. Esa
conexión es **por miembro**, y es la que Athos usa cuando ese miembro le pide algo:

- *"¿qué me escribió la dueña de Luna?"* → Athos lee **su** buzón;
- *"respondele que la esperamos el martes"* → el correo sale de **su** cuenta.

Si el miembro no conectó nada, la app se lo dice y le muestra cómo conectarla — no falla en silencio
ni cae a la cuenta de otro.

Cómo está armado:

- [`src/lib/composio/correo.ts`](src/lib/composio/correo.ts) — conectar, estado, y ejecutar
  operaciones con la cuenta de un miembro, **sin saber de qué proveedor es**. El `userId` de Composio
  **es nuestro `profiles.id`**: por eso la cuenta que conecta una persona es exactamente la que Athos
  usa cuando esa persona le pide algo, sin ninguna tabla intermedia que mantener sincronizada.
- [`src/lib/composio/proveedores.ts`](src/lib/composio/proveedores.ts) — lo único que sabe que Gmail
  y Outlook existen. Está separado porque **las tools no son intercambiables**: Gmail manda
  `recipient_email` y Outlook `to_email`; y responder es directamente otra operación — Gmail reusa el
  envío pasándole `thread_id` (el hilo), mientras Outlook tiene `OUTLOOK_OUTLOOK_REPLY_EMAIL`, que
  toma el id del **mensaje** y el texto en `comment`. Cada adaptador también **normaliza** la
  respuesta a una forma común (`CorreoNormalizado`), así la bandeja y las tools de Athos no cambian
  según quién esté conectado.
- Tools de Athos: `search_emails` y `read_email_thread` (lectura directa), `send_email` y
  `reply_email` (**propuesta** — el vet aprueba en la tarjeta, donde puede corregir destinatario,
  asunto y cuerpo antes de que salga).
- Se usa `connectedAccounts.link()`, no `initiate()`: para auth configs administradas, `initiate()`
  quedó retirado y responde 400. El SDK tiene una excepción dedicada para ese caso.

**Por qué el SDK y no REST**, que es el estilo del repo: Composio documenta el SDK y **no** su API
REST — la ejecución de tools no tiene endpoint publicado. Adivinar rutas contra una API sin
documentar es peor que una dependencia, y además el SDK trae los tipos, así que un cambio de forma
lo caza `tsc` en vez del primer clic de un veterinario.

**Un proveedor por persona, no los dos.** Athos escribe desde *una* dirección; con dos conectadas
habría que preguntar cuál en cada envío, o elegir por él y equivocarse. Conectar el segundo exige
desconectar el primero.

**Por qué Composio y no App Password:** leer Gmail exige scopes **restringidos**
(`gmail.readonly`/`gmail.modify`), que para una app propia significan verificación de Google más una
auditoría **CASA renovable cada 12 meses**. El OAuth administrado de Composio evita ese trámite. La
contrapartida está asumida: al conectar, el veterinario ve el nombre de Composio en la pantalla de
consentimiento de Google, no el de Tuvetia. (Con credenciales propias diría "Tuvetia", pero vuelve
CASA.)

**Por qué no App Passwords, que sí funcionan:** dependen de que Google las siga permitiendo y de que
el admin de Workspace no las bloquee — y le piden al veterinario un trámite manual (activar 2FA,
generar una contraseña de 16 caracteres, pegarla). OAuth es un clic.

---

## Agregar un correo transaccional nuevo

1. Llamá a `sendTransactionalEmail(clinicId, { to, subject, text })`. **No** armes el `From` a mano.
2. Si esperás respuesta del cliente, pasá un `messageId` (con
   [`buildMessageId`](src/lib/email/threading.ts)) y guardalo: es la raíz del hilo y lo que después
   permite atribuir la respuesta.
3. Si el correo puede reprogramarse (como la cobranza), respetá el flag `transient` del resultado:
   distingue un fallo de red o un 429 —reintentable— de uno de configuración, que reintentar no
   arregla.

## La bandeja se lee EN VIVO

Comunicaciones → Correo consulta Gmail cuando se abre la página. **No hay copia en nuestra base:**
ni tablas de correo, ni barrido periódico, ni realtime.

Antes sí la había (`email_threads`/`email_messages`, llenadas por IMAP) y el precio era alto: un
cursor que mantener, deduplicación, hilado, y el correo entero de la clínica guardado en nuestros
servidores — superficie bajo Ley 1581 que no hacía falta. El costo de leer en vivo es esperar a
Gmail al abrir; a cambio desaparece todo ese aparato.

Se muestra el comienzo de cada correo, con enlace para abrirlo completo en Gmail.

## Lo que ya se retiró

`src/lib/email/{imap,inbox,send-user-email,sync}.ts`, la ruta `/api/email/sync` y los barridos IMAP
del cron. La conexión por App Password dejó de usarse para el correo del miembro.

**Se perdió una cosa, a propósito:** la lectura automática de respuestas a facturas. Clasificaba la
intención del cliente, guardaba el comprobante adjunto y creaba la tarea de verificación. Las
facturas ahora salen con Reply-To al administrador y **él lee las respuestas en su correo, como
cualquier persona**. Los comprobantes que llegan por **WhatsApp** se siguen capturando solos.

**Se pierde una cosa, y es a propósito:** la lectura automática de respuestas a facturas. Hoy
`sync.ts` lee el buzón institucional, clasifica la intención del cliente (promesa de pago, disputa),
guarda el comprobante adjunto y crea la tarea de verificación. Al desaparecer el buzón institucional
eso deja de existir: las facturas salen con Reply-To al administrador y **él lee las respuestas en
su correo, como cualquier persona**. Los comprobantes que llegan por **WhatsApp** se siguen
capturando solos — ese canal tiene su propio webhook.

## Configuración

```bash
# Transaccional (Resend)
RESEND_API_KEY=            # API key de Resend (server, nunca NEXT_PUBLIC_)
TRANSACTIONAL_FROM_EMAIL=vet@tuvetia.com

# Correo de Athos (Composio)
COMPOSIO_API_KEY=                 # necesita permiso de ESCRITURA sobre connected_accounts
COMPOSIO_GMAIL_AUTH_CONFIG_ID=    # ac_... del Auth Config de Gmail
COMPOSIO_OUTLOOK_AUTH_CONFIG_ID=  # ac_... del Auth Config de Outlook
```

Los dos auth configs son **opcionales por separado**: se ofrece en Conexiones solo el proveedor cuyo
`ac_...` esté definido. Así se puede habilitar Outlook cuando esté listo sin tocar código.

Dos cosas que costaron un rato descubrir, ambas verificadas contra la API real:

- La API key necesita **escritura** sobre `connected_accounts`. Con una de solo lectura se pueden
  listar cuentas pero no crear ninguna, y el error del SDK ("Failed to create connected account
  link") no lo dice — ya viene traducido en
  [`composio/correo.ts`](src/lib/composio/correo.ts).
- Ejecutar una tool exige declarar la **versión del toolkit, con fecha**: `"latest"` no sirve para
  ejecución manual. Están fijadas en el código y se pueden pisar con
  `COMPOSIO_GMAIL_TOOLKIT_VERSION` / `COMPOSIO_OUTLOOK_TOOLKIT_VERSION` para probar una nueva sin
  desplegar.

**Antes del primer envío hay que verificar el dominio en Resend** (registros SPF y DKIM de
`tuvetia.com`). Sin eso Resend rechaza con *"domain is not verified"* — el error ya viene traducido a
esa frase en [`resend.ts`](src/lib/email/resend.ts), no a un número.

Como todo el correo transaccional sale de un solo dominio, su reputación es compartida entre todas
las clínicas: un envío masivo mal hecho desde una clínica afecta la entrega de las facturas de
todas. Antes de cualquier tanda grande conviene tener manejo de rebotes y enlace de baja.

## Verificación

- `npx vitest run src/lib/cartera/__tests__/channels-email.test.ts` — el canal de cobranza: que no
  pierda un recordatorio y que propague `transient`.
- Manual: emitir una factura y enviarla por correo → confirmar que llega **desde
  `vet@tuvetia.com`**, que el remitente muestra el **nombre de la clínica**, y que al responder el
  destinatario es el **admin**.
- Manual, Athos: conectar una cuenta en Conexiones → pedirle a Athos que lea el correo y que
  redacte uno → aprobar la tarjeta → confirmar que salió de **esa** cuenta.

**Pendiente de verificar con una cuenta real de Outlook:** la forma exacta de la respuesta de
`OUTLOOK_OUTLOOK_SEARCH_MESSAGES`. El normalizador está escrito contra la forma de Microsoft Graph y
lee cada campo defensivamente (una bandeja que muestra "(sin asunto)" es mejor que una que revienta),
pero hasta que alguien conecte Outlook de verdad no está confirmado que Composio pase los mensajes
tal cual. Gmail sí está verificado punta a punta.

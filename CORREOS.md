# Correos de Tuvetia

Tuvetia manda y lee correo por **exactamente dos caminos**. No hay un tercero, y agregarlo es una
decisión de arquitectura, no un detalle de implementación.

| | Sale de | Lo usa | Transporte |
|---|---|---|---|
| **Transaccional** | `vet@tuvetia.com`, firmado con el nombre de la clínica | Facturas, cobranza, y las notificaciones de `/admin` a los veterinarios | **Resend** |
| **De Athos** | La cuenta Google que conectó **cada miembro** | Athos leyendo y escribiendo correo, y la bandeja de Comunicaciones | **Composio** (OAuth) |

**La regla en una línea:** si el correo lo manda *el sistema*, va por Resend; si lo manda *una
persona* (o Athos por ella), va por Composio con la cuenta de esa persona.

> **Estado:** Composio ya está conectado a Athos — el veterinario conecta su Gmail en Conexiones y
> Athos lee y escribe con esa cuenta. Falta migrar la **bandeja** de Comunicaciones, que todavía se
> llena por IMAP; hasta que eso pase, el camino viejo sigue en pie. Ver §Qué falta.

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

Cada miembro conecta **su** cuenta de Google en Conexiones (Microsoft queda para después). Esa
conexión es **por miembro**, y es la que Athos usa cuando ese miembro le pide algo:

- *"¿qué me escribió la dueña de Luna?"* → Athos lee **su** buzón;
- *"respondele que la esperamos el martes"* → el correo sale de **su** cuenta.

Si el miembro no conectó nada, la app se lo dice y le muestra cómo conectarla — no falla en silencio
ni cae a la cuenta de otro.

Cómo está armado:

- [`src/lib/composio/gmail.ts`](src/lib/composio/gmail.ts) — conectar, estado, y ejecutar las tools
  de Gmail con la cuenta de un miembro. El `userId` de Composio **es nuestro `profiles.id`**: por eso
  la cuenta que conecta una persona es exactamente la que Athos usa cuando esa persona le pide algo,
  sin ninguna tabla intermedia que mantener sincronizada.
- Tools de Athos: `search_emails` y `read_email_thread` (lectura directa), `send_email` y
  `reply_email` (**propuesta** — el vet aprueba en la tarjeta, donde puede corregir destinatario,
  asunto y cuerpo antes de que salga).
- Se usa `connectedAccounts.link()`, no `initiate()`: para auth configs administradas, `initiate()`
  quedó retirado y responde 400. El SDK tiene una excepción dedicada para ese caso.

**Por qué el SDK y no REST**, que es el estilo del repo: Composio documenta el SDK y **no** su API
REST — la ejecución de tools no tiene endpoint publicado. Adivinar rutas contra una API sin
documentar es peor que una dependencia, y además el SDK trae los tipos, así que un cambio de forma
lo caza `tsc` en vez del primer clic de un veterinario.

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

## Qué falta

**Migrar la bandeja de Comunicaciones → Correo a Composio.** Hoy se llena con el barrido IMAP
(`src/lib/email/inbox.ts`), que todavía usa la conexión por App Password. Cuando pase a Composio se
retira todo el camino viejo:

- `src/lib/email/{smtp,imap,integrations,actions,send-user-email,inbox,sync}.ts`
- `src/components/settings/email-settings.tsx` (el formulario de App Password)
- Las tablas `email_integrations` e `invoice_email_threads`
- Los dos barridos IMAP colgados del cron de cartera

El orden importa: **primero se verifica que Composio funcione con una cuenta real, después se
borra lo anterior.** Al revés, un Auth Config mal configurado deja a Athos sin ningún camino.

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
COMPOSIO_API_KEY=          # API key del proyecto en Composio
COMPOSIO_GMAIL_AUTH_CONFIG_ID=   # ac_... del Auth Config de Gmail
```

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

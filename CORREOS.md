# Correos de Tuvetia

Tuvetia manda correo por **tres caminos distintos**, y confundirlos es el error caro. Este documento
dice cuál usar y por qué existe cada uno.

| | Sale de | Lo usa | Transporte |
|---|---|---|---|
| **Transaccional** | `vet@tuvetia.com`, firmado con el nombre de la clínica | Facturas, cobranza, notificaciones | **Resend** |
| **Personal** | La cuenta que cada miembro conectó | Bandeja de Comunicaciones, correos que redacta Athos | SMTP de esa cuenta |
| **Plataforma** | El remitente propio de Tuvetia | Correos de `/admin` a los usuarios de la plataforma | SMTP de plataforma |

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

## 2. Personal — la bandeja de cada miembro

Cada miembro conecta **su** cuenta en Conexiones → *Mi correo* (App Password de Gmail). De ahí:

- se lee su bandeja, que se ve en **Comunicaciones → Correo**;
- salen los correos que **Athos** redacta para los titulares y el vet aprueba.

Punto de entrada: [`sendUserEmail`](src/lib/email/send-user-email.ts). Cada bandeja es privada — la
RLS es `user_id = auth.uid()`, así que un miembro no ve el correo de otro.

**Por qué SMTP/IMAP y no la API de Gmail:** `gmail.readonly`, `gmail.modify` y `gmail.compose` son
scopes **restringidos** de Google: exigen verificación más una auditoría CASA renovable cada 12
meses. Las App Passwords están exceptuadas y sirven para enviar **y** leer. Además IMAP es estándar,
así que la misma implementación va a servir para Outlook. Está documentado en el encabezado de la
migración `0039`.

---

## 3. Plataforma — Tuvetia hablándole a sus usuarios

[`platform-sender.ts`](src/lib/email/platform-sender.ts), por SMTP propio
(`PLATFORM_SMTP_*`). Lo usa el envío desde `/admin/usuarios`. Es correo de Tuvetia a **sus** usuarios
(los veterinarios), no a clientes de una clínica — por eso no lleva nombre de clínica ni Reply-To.

---

## Agregar un correo transaccional nuevo

1. Llamá a `sendTransactionalEmail(clinicId, { to, subject, text })`. **No** armes el `From` a mano.
2. Si esperás respuesta del cliente, pasá un `messageId` (con
   [`buildMessageId`](src/lib/email/threading.ts)) y guardalo: es la raíz del hilo y lo que después
   permite atribuir la respuesta.
3. Si el correo puede reprogramarse (como la cobranza), respetá el flag `transient` del resultado:
   distingue un fallo de red o un 429 —reintentable— de uno de configuración, que reintentar no
   arregla.

## Configuración

```bash
RESEND_API_KEY=            # API key de Resend (server, nunca NEXT_PUBLIC_)
TRANSACTIONAL_FROM_EMAIL=vet@tuvetia.com
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

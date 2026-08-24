---
titulo: Secretos y variables de entorno
seccion: referencia
orden: 10
resumen: Las 55 variables que el sistema lee: qué hace cada una, de dónde se saca y qué se rompe si falta.
---

# Secretos y variables de entorno

Todas las variables del front viven en `.env.local` (local) o en Vercel (desplegado). El servicio
Python tiene las suyas aparte, en `athos-service/.env.example`.

> **La regla que no se negocia:** cualquier variable que empiece con `NEXT_PUBLIC_` **se embebe en el
> bundle que descarga el navegador**. Poner un secreto ahí es publicarlo. Las demás sólo existen del
> lado del servidor.

## Las cuatro obligatorias

Sin estas la aplicación no arranca. Todo lo demás habilita módulos.

| Variable | Origen | Si falta |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | La app no conecta con la base |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | misma pantalla | No hay sesión posible |
| `SUPABASE_SERVICE_ROLE_KEY` | misma pantalla. **Secreto máximo** | `createAdminClient()` lanza excepción: las escrituras del agente y todo el ciclo de aprobación fallan en caliente |
| `NEXT_PUBLIC_ATHOS_URL` | La URL del servicio en Railway | El chat clínico y la búsqueda de literatura devuelven error |

### Sobre `SUPABASE_SERVICE_ROLE_KEY`

**Se salta toda la RLS.** Es la llave maestra de la base: con ella se leen y escriben los datos de
todas las clínicas sin ninguna frontera. Se usa sólo donde no hay más remedio —webhooks que llegan
sin sesión, crons, el push al calendario— y cada uno de esos lugares **revalida a mano** a qué
clínica pertenece lo que va a tocar. Ver [Multi-inquilino y RLS](../40-explicacion/10-multitenant-y-rls.md).

## Inteligencia artificial

| Variable | Para qué | Si falta |
|---|---|---|
| `ANTHROPIC_API_KEY` | El proveedor por defecto de todo el agente. **La lee el SDK directo del entorno**, por eso no aparece en el código | El asistente queda caído |
| `ATHOS_AGENT_PROVIDER` / `ATHOS_AGENT_MODEL` | Modelo del agente con herramientas | Cae al default del código |
| `ATHOS_AUTO_PROVIDER` / `ATHOS_AUTO_MODEL` | Modelo del modo automático de WhatsApp | Cae al default |
| `ATHOS_VISION_MODEL` | Lectura de facturas y recetas por foto | Cae al default |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` | Sólo si algún rol apunta a DeepSeek | Ese rol falla |
| `GEMINI_API_KEY` / `GEMINI_BASE_URL` | Sólo si alguna cascada nombra `@google` | Esa cascada falla |

**Nunca hay un modelo escrito a fuego en el código**: vacío significa "el default", y el default está
en un solo lugar.

### Las cascadas

`ATHOS_AGENT_CASCADE`, `ATHOS_AUTO_CASCADE`, `ATHOS_VISION_CASCADE`. Formato `modelo@proveedor,…` en
orden de preferencia — el mismo dialecto que usa `athos-service`, para no tener dos.

Vacía = un solo proveedor. **Si está puesta, manda** sobre el par `ATHOS_*_PROVIDER` / `ATHOS_*_MODEL`
de esa superficie.

> **Por qué existen.** El 2026-07-31 la cuenta de Anthropic se quedó sin crédito y el asistente se
> cayó entero, mientras el chat clínico —que sí tenía cascada— siguió respondiendo. Se cae al
> respaldo **antes del primer token**, nunca a mitad de respuesta, y **sólo ante fallos del
> proveedor** (saldo, cuota, credencial, 429/503, timeouts). Un error nuestro no se reintenta:
> fallaría igual en el segundo.

### `ATHOS_TOPE_MENSUAL_POR_CLINICA`

Techo de llamadas al modelo por clínica y por mes (calendario de Bogotá). Cuenta **todas** las
superficies contra el mismo cupo: chat, widget, sugerencia de la bandeja, modo automático, cartera y
lectura por foto.

| Valor | Efecto |
|---|---|
| *(vacía)* | Tope de contención: **1000/mes** |
| `ninguno` | Sin tope. El escape si el de contención llegara a cortarle a alguien de verdad |
| un entero | Ese número |
| `0` | Athos apagado para todos (kill-switch) |
| cualquier otra cosa | Tope de contención, con aviso en el log |

Que vacía signifique 1000 y no "sin tope" cambió el 2026-08-16: antes vacía era sin límite y, como
tampoco estaba puesta en Vercel, **el gasto de IA no tenía ningún techo en producción**. Un techo que
depende de que alguien lo configure no es un techo.

Al llegar al tope, las pantallas responden `402` y las superficies de fondo se callan y escalan a una
persona. El resto de Tuvetia sigue igual. La cuenta va **un turno atrás** (el consumo se registra
después de responder), así que con varias pestañas se puede pasar por unas pocas llamadas: es un tope
de contención, no un medidor exacto.

## Tareas programadas

| Variable | Para qué |
|---|---|
| `CRON_SECRET` | Secreto compartido de los dos crons. Generar con `openssl rand -base64 32` |

Si falta, `/api/cron/purge-audio` y `/api/cron/cartera` devuelven `503`. **Ojo: la purga es la que
borra el audio de las consultas a los 4 días** — sin ella se incumple la retención de la Ley 1581 en
silencio.

## URLs base

| Variable | Para qué | Trampa |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Enlaces absolutos en correos y WhatsApp | En Vercel cae a la URL del deployment; en local hay que ponerla |
| `NEXT_PUBLIC_SITE_URL` | Webhook de Evolution y retorno de Kapso | El retorno de Kapso la lee con `??`, así que **definirla en blanco gana al fallback y rompe el redirect**. O tiene valor, o no se define |

## Composio — correo y calendario

Composio maneja el OAuth de terceros: **Tuvetia no guarda ningún token de Google ni de Microsoft**.

| Variable | Para qué |
|---|---|
| `COMPOSIO_API_KEY` | La cuenta. Necesita permiso de **escritura** sobre `connected_accounts` |
| `COMPOSIO_GMAIL_AUTH_CONFIG_ID` | Habilita conectar Gmail |
| `COMPOSIO_OUTLOOK_AUTH_CONFIG_ID` | Habilita Outlook — **correo y calendario a la vez** |
| `COMPOSIO_GOOGLECALENDAR_AUTH_CONFIG_ID` | Habilita Google Calendar |
| `COMPOSIO_*_TOOLKIT_VERSION` | Fijan la versión del toolkit. Sólo para probar una versión nueva sin desplegar |

Los `AUTH_CONFIG_ID` **no son secretos**: salen del dashboard de Composio.

Dos cosas que sorprenden:

- **Outlook Calendar no tiene variable propia.** Vive en el mismo toolkit que el correo de Outlook:
  una conexión sirve para los dos, y desconectar una desconecta la otra.
- **Ejecutar una tool a mano exige una versión con fecha.** `latest` no sirve, y la versión default
  del toolkit tampoco: es la que se mueve sola, así que un cambio de forma llegaría a producción sin
  aviso.

## Correo transaccional (Resend)

De acá salen las **facturas**, los recordatorios de cobranza y toda notificación que Tuvetia le manda
a un cliente en nombre de una clínica.

| Variable | Para qué |
|---|---|
| `RESEND_API_KEY` | La cuenta. Sin ella las facturas no salen y el canal EMAIL de cobranza queda deshabilitado |
| `TRANSACTIONAL_FROM_EMAIL` | El remitente, siempre el mismo (`vet@tuvetia.com`) |
| `PLATFORM_FROM_NAME` | Nombre visible de los correos **de plataforma**. Los de clínica usan el nombre de la clínica |

**Antes del primer envío hay que verificar el dominio en Resend** (SPF y DKIM). Sin eso, Resend
rechaza todo con *"domain is not verified"*.

## WhatsApp

Hay **tres proveedores posibles** y conviven. Ver [Servicios externos](20-servicios-externos.md).

| Variable | Proveedor | Para qué |
|---|---|---|
| `WHATSAPP_TOKEN_KEY` | — | Cifra el token de cada clínica antes de guardarlo (AES-256-GCM). 32 bytes en base64 |
| `NEXT_PUBLIC_WA_PROVIDER` | — | Qué proveedor ofrece la UI: `evolution` o vacío (= Kapso) |
| `META_APP_ID` / `META_APP_SECRET` | Meta | La app de Meta. El secret es secreto |
| `META_WEBHOOK_VERIFY_TOKEN` | Meta | Lo inventás vos; el mismo valor va en Meta → Webhooks |
| `META_REGISTER_PIN` | Meta | PIN de verificación en dos pasos. **El código default-ea a `000000`**: ponelo de verdad antes de conectar un número real |
| `NEXT_PUBLIC_META_APP_ID` | Meta | El mismo valor que `META_APP_ID` (no es secreto) |
| `NEXT_PUBLIC_META_ES_CONFIG_ID` | Meta | El `config_id` del Embedded Signup |
| `EVOLUTION_BASE_URL` | Evolution | El subdominio del contenedor que desplegás vos |
| `EVOLUTION_API_KEY` | Evolution | Debe ser idéntica a `AUTHENTICATION_API_KEY` del contenedor |
| `EVOLUTION_WEBHOOK_TOKEN` | Evolution | **Evolution no firma sus llamadas: este token *es* la autenticación**. Es el segmento secreto de la URL del webhook |
| `KAPSO_API_KEY` / `KAPSO_WEBHOOK_SECRET` | Kapso | Legado, en retirada |

Con `NEXT_PUBLIC_WA_PROVIDER` vacío y sin las de Meta, el flujo de conexión **redirige fuera de la
plataforma**.

## Pagos (Wompi)

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_WOMPI_PUBLIC_KEY` | La única que puede ir al navegador, **y tiene que ir**: el número de tarjeta viaja del navegador a Wompi directo, sin pasar por nuestro servidor. Eso mantiene el alcance PCI en el mínimo |
| `WOMPI_PRIVATE_KEY` | Crea fuentes de pago y **cobra**. Si se filtra, cualquiera puede cobrarle a las tarjetas guardadas de todas las clínicas |
| `WOMPI_INTEGRITY_SECRET` | Firma el monto de cada cobro (SHA256 de referencia + monto + moneda + secreto) |
| `WOMPI_EVENTS_SECRET` | Valida los webhooks entrantes |
| `PLAN_PRO_PRECIO_CENTAVOS` | Precio mensual de Pro **en centavos**. `20000000` = $200.000 COP. Vacía = $200.000 |

Tres cosas críticas:

1. **Las cuatro llaves son del mismo ambiente, siempre.** El ambiente no se configura: se *deduce*
   del prefijo (`pub_test_` → sandbox, `pub_prod_` → producción). Si las cuatro no coinciden, la
   integración se declara mal configurada y no cobra nada. Una variable de ambiente aparte haría que
   todo "funcionara" contra el lugar equivocado y se descubriría al cerrar el mes.
2. **Sin `WOMPI_EVENTS_SECRET`, `/api/wompi/webhook` no aplica ningún evento.** Un webhook que acepta
   a ciegas porque le falta una variable es peor que uno caído: cualquiera podría regalarse Pro con
   un POST.
3. `PLAN_PRO_PRECIO_CENTAVOS` **no es `NEXT_PUBLIC_`** a propósito. El monto que se le manda a Wompi
   sale del servidor y de ningún otro lado. Un `200.000` con punto se convierte en `NaN` y
   terminaría en un cobro por cero que Wompi rechaza sin decir por qué; por eso un valor inválido cae
   al default y queda ruidoso en el log.

Además hay que registrar la URL del webhook en Wompi (`https://<dominio>/api/wompi/webhook`), y la
configuración es **separada por ambiente**: la que guardes en pruebas no viaja a producción.

## Varios

| Variable | Para qué |
|---|---|
| `PLATFORM_ADMIN_EMAILS` | Correos con acceso a `/admin`, separados por coma. **Sin ella no entra nadie** (seguro por defecto) |
| `CARTERA_MESSAGING_SIMULATED` | Con `1`, el motor de cobranza no envía nada real |
| `NEXT_PUBLIC_SENTRY_DSN` | Reporte de errores |
| `NEXT_PUBLIC_VERCEL_ENV` / `VERCEL_ENV` / `VERCEL_URL` | Las inyecta Vercel |

## Cómo comprobar que un entorno está completo

`GET /api/health` reporta qué está configurado y qué no. Es la forma rápida de ver si a un despliegue
le falta algo antes de que lo descubra un usuario.

# Configuración de producción — qué variable va dónde, de dónde sale y para qué sirve

> Guía operativa para dejar producción bien configurada. Está escrita para seguirse **sin leer
> código**: cada variable dice qué función cumple, de dónde se saca su valor, en qué panel se pega y
> si exige volver a desplegar.
>
> El termómetro de todo esto es `GET /api/health`, que responde **solo booleanos** (nunca valores) y
> lista en `missing` lo que falta.
>
> ⚠️ **LA FUENTE DE VERDAD ES EL ENDPOINT, NO ESTE DOCUMENTO.** Este archivo se escribió el
> **2026-07-31** y para el 16-ago ya mentía: declaraba cuatro variables como faltantes que llevaban
> semanas configuradas. Un documento que congela un estado envejece sin avisar; el endpoint no.
>
> **Para saber qué falta hoy:** correr el workflow `smoke` desde Actions. Falla si `missing` no está
> vacío y dice exactamente qué.
>
> Lo que sigue vigente de este archivo, y es la mayor parte, es **de dónde sale cada valor y en qué
> panel se pega**. Eso no caduca.

## Las tres reglas que evitan el 90 % de los errores

1. **Hay tres lugares distintos donde van variables**, y confundirlos es el error más común:
   **Vercel** (el front y sus APIs), **Railway → athos-service** (el backend de IA) y
   **Railway → Evolution** (el servidor de WhatsApp). Una variable puesta en el lugar equivocado no
   da error: simplemente no hace nada.
2. **`CRON_SECRET` vive en dos almacenes**: la env de Vercel *y* los Secrets de GitHub Actions. Son
   independientes. Ponerlo solo en uno deja el barrido de cartera en rojo (pasó el 30-jul: 6/6
   ejecuciones fallidas sin que nadie lo viera).
3. **Todo lo que empieza con `NEXT_PUBLIC_` se incrusta al compilar.** Guardarlo en Vercel no basta:
   **hay que hacer Redeploy** o el sitio sigue con el valor viejo. Y como viaja al navegador,
   **jamás se pone un secreto ahí**.

---

## 1. Cómo saber qué falta — y por qué no hay una lista acá

**Este documento ya no dice qué falta.** Lo decía, y ahí estuvo el problema: la tabla original
declaraba cuatro variables como faltantes (`WHATSAPP_TOKEN_KEY`, `NEXT_PUBLIC_SITE_URL`,
`EVOLUTION_*` y `NEXT_PUBLIC_WA_PROVIDER`) y para el 16-ago **las cuatro estaban configuradas desde
semanas antes**. Quien leyera esto habría salido a arreglar algo que no estaba roto.

**La única fuente de verdad es `GET /api/health`.** Se consulta corriendo el workflow **`smoke`**
desde la pestaña Actions de GitHub: falla si `missing` no está vacío y dice qué falta. Verificado el
2026-08-16 — pasó con `missing: []`, o sea las 14 variables críticas cableadas.

El endpoint responde **sólo booleanos**: nunca un valor, ni un prefijo, ni una longitud. Se puede
consultar sin miedo a filtrar nada.

> **Nota sobre `WHATSAPP_TOKEN_KEY`.** Lo que sigue (§1.1) dice que cifra "todo secreto de terceros",
> incluidas las credenciales SMTP/IMAP de cada clínica. **Eso era cierto cuando se escribió.** Hoy el
> correo va por Composio —que guarda las conexiones en sus propios servidores— y `email_integrations`
> quedó retirada, con **0 filas**. En la práctica esta llave protege hoy sólo
> `whatsapp_integrations.access_token_enc`, que son **2 filas**. Sigue siendo una llave de cifrado y
> no una API key: rotarla deja esos tokens indescifrables. Ver `docs/traspaso/RUNBOOK.md`.

### 1.1 `WHATSAPP_TOKEN_KEY` — la llave de cifrado de todos los secretos

**Qué hace.** A pesar del nombre (quedó así porque el primer uso fue WhatsApp), es la llave
AES-256-GCM con la que se cifra **todo secreto de terceros que se guarda en la base**: los business
tokens de Meta y **las credenciales de correo SMTP/IMAP de cada clínica**. Sin ella, cualquier
operación que cifre o descifre lanza excepción.

**De dónde sale.** No la da ningún proveedor: **se genera**. Formato obligatorio, **32 bytes en
base64** — el código valida exactamente eso y rechaza cualquier otra longitud.

```powershell
$bytes = New-Object byte[] 32
(New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Salen 44 caracteres terminados en `=`. **El `=` es parte del valor**: recortarlo deja menos de 32
bytes y el chequeo sigue fallando.

**Dónde se pega.** Vercel → proyecto → Settings → Environment Variables → Add New → entorno
**Production**.

> ⚠️ **Rotarla no es gratis.** Hoy hay **cero** secretos cifrados en la base, así que generar una es
> inocuo. En cuanto una clínica conecte WhatsApp o correo, cambiar esta llave deja esos secretos
> **indescifrables para siempre**: rotarla obligaría a re-cifrar todo en la misma operación.

### 1.2 `NEXT_PUBLIC_SITE_URL` — el origen público

**Qué hace.** Es la base con la que se arma la URL del webhook que Evolution va a llamar cuando
entre un mensaje.

**Valor exacto**, sin barra final: `https://tuvetia.vercel.app`

> ⚠️ **Trampa**: el retorno de Kapso la lee con `??`, así que una variable **definida en blanco gana
> al valor por defecto** y produce un redirect roto. O se define con valor, o no se define.

**Exige Redeploy** (§6).

---

## 2. Los tres proveedores de WhatsApp

**Conviven, no se excluyen.** El transporte se elige **por clínica** (columna
`whatsapp_integrations.provider`), así que se pueden tener credenciales de los tres a la vez.

Lo que **sí** es excluyente es **qué botón ve el veterinario**, y lo decide una sola variable con
esta precedencia: **Evolution → Meta → Kapso**.

| Proveedor | Estado | Trámite | Vincula por QR |
|---|---|---|---|
| **Evolution** | Principal | Ninguno | ✅ Sí — la única vía |
| **Meta Cloud API** | Plan B oficial | App Review: 2-6 semanas | ❌ No |
| **Kapso** | Legado, en retirada | — | ❌ Saca al usuario de la plataforma |

> Si `NEXT_PUBLIC_WA_PROVIDER` no vale exactamente `evolution` y no están las de Meta, el botón
> "Conectar" **cae a Kapso**. No falla: hace algo equivocado, que es peor.

---

## 3. Desplegar Evolution API (Railway)

**Evolution no es un servicio contratable: no hay cuenta, ni panel, ni credenciales que pedirle a
nadie.** Es software open source que corre en un contenedor propio. Por eso `EVOLUTION_BASE_URL` es
*tu* URL y `EVOLUTION_API_KEY` es una contraseña que *tú inventas* y pones en los dos lados.

No puede vivir en Vercel: mantiene sesiones WebSocket abiertas contra WhatsApp y necesita un proceso
persistente. El paso a paso completo está en **`docs/EVOLUTION.md` §Deploy**; acá el resumen.

### 3.1 El contenedor

En Railway, nuevo servicio desde imagen Docker:

- **Imagen:** `evoapicloud/evolution-api:latest` (mejor pinnear una `2.x`).
- **Volumen persistente** montado en `/evolution/instances`. **No es opcional**: ahí viven las
  credenciales de sesión de cada teléfono. Sin volumen, un reinicio desvincula todos los números y
  hay que re-escanear los QR.
- **Postgres propio** (uno pequeño en el mismo Railway).

### 3.2 Variables **del contenedor** (van en Railway, NO en Vercel)

| Variable | Valor |
|---|---|
| `AUTHENTICATION_API_KEY` | La llave que inventas. **Anótala**: es la misma que `EVOLUTION_API_KEY` en Vercel |
| `SERVER_URL` | `https://<subdominio-railway>` — el que Railway asigna al servicio |
| `DATABASE_ENABLED` | `true` |
| `DATABASE_PROVIDER` | `postgresql` |
| `DATABASE_CONNECTION_URI` | La cadena de conexión del Postgres del paso anterior |
| `WEBHOOK_GLOBAL_ENABLED` | `false` — los webhooks se registran por instancia desde tuvetia |
| `CONFIG_SESSION_PHONE_CLIENT` | `Tuvetia` — el nombre que ve el vet en "Dispositivos vinculados" |
| `QRCODE_LIMIT` | `30` |

### 3.3 Comprobar que está vivo **antes** de seguir

```bash
curl -H "apikey: <AUTHENTICATION_API_KEY>" https://<subdominio-railway>/instance/fetchInstances
```
Debe responder `200` con `[]`. Si da 401, la llave no coincide; si no responde, el contenedor no
levantó (mirar los logs de Railway).

### 3.4 Variables **de Evolution en Vercel**

| Variable | De dónde sale | Para qué sirve |
|---|---|---|
| `EVOLUTION_BASE_URL` | El subdominio de Railway del paso 3.1 | A qué servidor le habla tuvetia |
| `EVOLUTION_API_KEY` | **La misma** `AUTHENTICATION_API_KEY` del contenedor | Autentica a tuvetia contra Evolution |
| `EVOLUTION_WEBHOOK_TOKEN` | **Se genera** (comando abajo) | Segmento secreto de la URL del webhook. Evolution **no firma** sus llamadas: este token en la ruta *es* toda la autenticación |
| `NEXT_PUBLIC_WA_PROVIDER` | Literal: `evolution` | Activa el flujo de QR en Configuración |

Generador del token del webhook (equivalente Windows de `openssl rand -hex 32`):

```powershell
$b = New-Object byte[] 32
(New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b)
-join ($b | ForEach-Object { $_.ToString('x2') })
```

> Nunca uses `Get-Random` para generar secretos: no es un generador criptográfico y es predecible.

---

## 4. Meta / WhatsApp Cloud API (plan B — no configurado)

Bloqueado por el App Review de Meta, que es un trámite de un tercero de 2-6 semanas. Se documenta
para cuando toque.

| Variable | De dónde sale |
|---|---|
| `META_APP_ID` | developers.facebook.com → tu App → Configuración → Básica → "Identificador de la aplicación" |
| `META_APP_SECRET` | Misma pantalla → "Clave secreta de la aplicación" (botón *Mostrar*). **Secreto** |
| `META_WEBHOOK_VERIFY_TOKEN` | **La inventas tú.** El mismo valor se pega en Meta → WhatsApp → Configuración → Webhooks → "Token de verificación" |
| `META_REGISTER_PIN` | Lo eliges: 6 dígitos. ⚠️ El código default-ea a `000000` — **ponlo de verdad antes de conectar un número real** |
| `NEXT_PUBLIC_META_APP_ID` | El mismo valor que `META_APP_ID` (no es secreto) |
| `NEXT_PUBLIC_META_ES_CONFIG_ID` | App → WhatsApp → Embedded Signup → crear configuración → copiar el `config_id` |

---

## 5. El resto de variables de producción

### 5.1 Vercel (front) — obligatorias

| Variable | De dónde sale | Sin ella |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → *Project URL* | La app no arranca |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Misma pantalla → *anon / public* | No hay sesión |
| `SUPABASE_SERVICE_ROLE_KEY` | Misma pantalla → *service_role*. **Se salta toda la RLS: secreto máximo** | Fallan webhooks, crons, escrituras del agente |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | El asistente de 17 herramientas no responde |
| `NEXT_PUBLIC_ATHOS_URL` | La URL del backend en Railway | El chat clínico y la búsqueda de literatura fallan |
| `CRON_SECRET` | **Se genera.** Va en Vercel **y** en GitHub Actions Secrets | Los crons y `/api/health` devuelven 503 |
| `PLATFORM_ADMIN_EMAILS` | Los escribes: `correo1@x.com,correo2@y.com` | **Nadie** puede entrar a `/admin` |

### 5.2 Vercel — opcionales con valor por defecto correcto

`NEXT_PUBLIC_APP_URL` (cae a la URL que Vercel provee sola), `ATHOS_AGENT_PROVIDER`,
`ATHOS_AGENT_MODEL`, `ATHOS_AUTO_*`, `ATHOS_VISION_MODEL`, `DEEPSEEK_API_KEY` (solo si el agente
apunta a DeepSeek), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (solo para sincronizar Google
Calendar; el calendario interno funciona sin ellas).

`CARTERA_MESSAGING_SIMULATED` merece mención aparte: con valor `1` **la cobranza no envía nada**.
En producción debe estar ausente o apagada — `/api/health` la marca como fallo si vale `1`.

### 5.3 Railway → athos-service (backend de IA)

Plantilla completa y comentada en `athos-service/.env.example`. Las que más importan:

| Variable | De dónde sale | Sin ella |
|---|---|---|
| `DATABASE_URL` | Supabase → Database → Connection string | El backend no arranca |
| `LLM_API_KEY` | console.anthropic.com o platform.deepseek.com según `LLM_PROVIDER` | No se redacta ninguna respuesta |
| `EMBEDDING_API_KEY` | dashboard.cohere.com → API Keys | El Tier 2 vectorial degrada (se queda con búsqueda léxica) |
| `DEEPGRAM_API_KEY` | console.deepgram.com → API Keys | **No hay transcripción de voz** (Modo Fantasma) |
| `CORS_ORIGINS` | El dominio del front, separado por comas | El chat falla por CORS desde el navegador |
| `SUPABASE_JWT_SECRET` | Supabase → API → JWT Settings | No se pueden verificar los tokens del front |

---

## 6. El Redeploy: por qué no se puede saltar

Ocho variables llevan el prefijo `NEXT_PUBLIC_` y Next.js **las incrusta en el código al compilar**:

`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `NEXT_PUBLIC_ATHOS_URL` ·
`NEXT_PUBLIC_APP_URL` · `NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_WA_PROVIDER` ·
`NEXT_PUBLIC_META_APP_ID` · `NEXT_PUBLIC_META_ES_CONFIG_ID`

Guardarlas en Vercel **no cambia nada** hasta que el sitio se reconstruye. Si algo "no toma efecto"
después de configurarlo, este es el motivo el 90 % de las veces.

**Cómo:** Vercel → Deployments → el último de Production → `⋯` → **Redeploy**.

---

## 7. Verificación

### 7.1 Qué está configurado (sin exponer ningún valor)

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://tuvetia.vercel.app/api/health
```

Devuelve solo booleanos. Cómo leer la respuesta:

- **`missing: []`** y `ok: true` → todo cableado.
- **`503`** → falta `CRON_SECRET` en Vercel.
- **`401`** → el secreto no coincide con el de Vercel. *(Esa distinción 401-vs-503 es justamente la
  que confirma que la variable existe, sin revelar su valor.)*
- **`whatsapp_provider_coherente: false`** → hay credenciales de algún proveedor, pero **no del que
  la UI está ofreciendo**. El campo `wa_provider_declarado` dice cuál está ofreciendo.

### 7.2 Evolution vivo

```bash
curl -H "apikey: <EVOLUTION_API_KEY>" <EVOLUTION_BASE_URL>/instance/fetchInstances   # → 200 []
```

### 7.3 El smoke automático

```bash
gh workflow run "Smoke E2E"
```
Debe quedar **29 passed, 0 skipped**. Un `skipped` significa que falta `CRON_SECRET` en los Secrets
de GitHub Actions y que el chequeo de configuración **no se está ejecutando**.

### 7.4 La única prueba que vale de verdad

Configuración → WhatsApp → aceptar el consentimiento de integración no oficial → **Conectar** → QR →
escanearlo desde WhatsApp → Dispositivos vinculados. La integración debe pasar a `connected`.
Después, enviar un mensaje al número desde otro teléfono y verlo llegar a la bandeja.

Los chequeos anteriores prueban que las variables **existen**; solo este prueba que el webhook y el
origen público están **bien**.

---

## Documentos relacionados

| Archivo | Para qué |
|---|---|
| `docs/EVOLUTION.md` | Despliegue detallado, flujo por clínica, protecciones anti-baneo, operación |
| `WHATSAPP.md` | Arquitectura de los tres proveedores y el trámite con Meta |
| `.env.example` | Plantilla comentada del front, con el origen de cada valor |
| `athos-service/.env.example` | Plantilla del backend (Railway) |
| `docs/SEGURIDAD-DB.md` | Revisión de las funciones `SECURITY DEFINER` y avisos del linter |

# Inventario de servicios y titularidad

> **Para qué existe.** Tuvetia no corre sobre una cuenta: corre sobre **quince**, repartidas en cinco
> plataformas y diez proveedores. Este documento las lista todas, dice qué se rompe si cada una se
> cae, y separa las que **se transfieren** de las que hay que **recrear**. Es el mapa del traspaso.
>
> **Cómo se armó.** Leyendo el repositorio, no de memoria: `.env.example` (front),
> `athos-service/.env.example` (backend) y `src/app/api/health/route.ts`, que es el único sitio que
> sabe qué está cableado en producción de verdad.

**Estado del traspaso:** sólo David está invitado a Supabase. Todo lo demás sigue a nombre de Plogy.

---

## Las dos clases de traspaso, que no se mezclan

**SE TRANSFIERE** — GitHub, Vercel, Railway y Supabase permiten mover el proyecto o la organización a
otra cuenta. Conserva historial, despliegues, datos y URLs. Es lo que se quiere siempre que exista.

**SE RECREA** — una API key no se transfiere. El cliente abre su cuenta, emite una clave nueva, se
carga en producción, **se redespliega**, y recién entonces se revoca la vieja. Cada una de éstas es
un pequeño corte con su ventana de riesgo.

> Confirmar el procedimiento exacto con cada proveedor al ejecutar: cambian sus paneles seguido.
> Lo que no cambia es a qué clase pertenece cada uno.

---

## Tabla maestra

Las columnas de titularidad quedan **vacías a propósito** — hay que llenarlas con datos reales, no
suponerlos.

| # | Servicio | Para qué | Clase | Titular hoy | Titular destino | Costo/mes |
|---|---|---|---|---|---|---|
| 1 | **GitHub** `plogy-dev/tuvetia` | El monorepo: front + `athos-service` | transferir | | | |
| 2 | **Vercel** | El front Next.js. Hoy plan **Hobby** | transferir | | | |
| 3 | **Railway** → `athos-service` | El backend de IA (FastAPI) | transferir | | | |
| 4 | **Railway** → Evolution | Contenedor de WhatsApp. **Es otro despliegue** | transferir | | | |
| 5 | **Supabase** principal `auxlnexhkmtoedrzfsnz` | Pacientes, clínicas, facturas. **Los datos** | transferir | Plogy + David | | |
| 6 | **Supabase** dev `gdiiagioiukadifejewv` | Corpus del RAG y desarrollo | transferir | | | |
| 7 | **Dominio / DNS** (`tuvetia.com`) | El origen público y el correo | transferir | | | |
| 8 | **Anthropic** | Agente, modo auto, visión | recrear | | | |
| 9 | **DeepSeek** | Proveedor en uso hoy en las 4 superficies | recrear | | | |
| 10 | **Google Gemini** | Tercer eslabón de la cascada | recrear | | | |
| 11 | **Cohere** | Embeddings del corpus (`embed-v4`) | recrear | | | |
| 12 | **Deepgram** | Transcripción **en vivo** de la consulta (WebSocket) | recrear | | | |
| 13 | **Composio** | Correo y calendario de Athos | recrear | | | |
| 14 | **Resend** | Correo transaccional y facturas | recrear | | | |
| 15 | **Meta WhatsApp** | Plan B, no configurado | recrear | | | |
| 16 | **Kapso** | Legado, en retirada | recrear | | | |
| — | **Wompi** | Pagos — **en curso, Santiago** | por definir | | | |
| — | **Sentry** | Aplazado a propósito: cableado, sin contratar | — | — | — | $0 |

---

## Detalle por servicio

### 1–2 · GitHub y Vercel

`plogy-dev/tuvetia` es un **monorepo**: el front en la raíz y `athos-service/` adentro. Railway
despliega apuntando su *Root Directory* a esa subcarpeta.

En GitHub no sólo está el código — están los **secretos de Actions**, que corren dos crons diarios
(briefing y cartera) porque Vercel Hobby sólo permite dos y ya están usados. Al transferir el repo
hay que **volver a cargar los secretos**: no viajan con él.

Vercel está en **Hobby**. Con cuenta propia conviene decidir si sube a Pro: eso destraba más crons y
alarga la retención de logs, que hoy es mínima.

### 3–4 · Railway: son DOS despliegues, no uno

| | Qué es | Si se cae |
|---|---|---|
| `athos-service` | FastAPI: chat clínico, RAG, Modo Fantasma | El chat y la búsqueda de literatura devuelven error |
| Evolution | Contenedor open source de WhatsApp | No entra ni sale ningún mensaje |

Evolution es **software libre en un contenedor propio** — no hay cuenta de proveedor que transferir,
pero sí un servicio que tiene que seguir corriendo y una URL que el front tiene apuntada.

### 5–6 · Supabase: dos proyectos con roles distintos

**El principal es lo único irremplazable de esta lista.** Todo lo demás se puede volver a contratar;
los datos clínicos, no.

- **Principal** `auxlnexhkmtoedrzfsnz` — pacientes, titulares, consultas, facturas, WhatsApp.
- **Dev** `gdiiagioiukadifejewv` — el corpus del RAG (~520k chunks) y el entorno de desarrollo.

**Regla de la casa, documentada en `athos-service/CLAUDE.md` y que sobrevive al traspaso:** nunca
`supabase db push` contra el principal, y ninguna herramienta con escritura apuntada ahí. Las
migraciones del repo se aplican **a mano** por el editor SQL, con su script de verificación.

### 7 · Dominio y DNS

De él dependen `NEXT_PUBLIC_SITE_URL` —el origen canónico de los redirects de OAuth y los enlaces de
cobranza— y el correo remitente (`vet@tuvetia.com`). Transferir un dominio tiene su propio tiempo de
espera; conviene arrancarlo temprano.

### 8–12 · Los cinco proveedores de IA

**Ojo con `ANTHROPIC_API_KEY`: no aparece en ningún grep del código.** La lee el SDK
`@ai-sdk/anthropic` del entorno por convención. `/api/health` la comprueba justamente por eso — un
grep del repo no la encuentra y pasa desapercibida.

**Cohere y Deepgram no estaban en ningún mapa previo**: salieron de `athos-service/.env.example` y se
confirmaron leyendo el código.

- **Cohere** (`app/embeddings.py`, proveedor por defecto) hace los embeddings del corpus con
  `embed-v4`. Sin él el retrieval degrada al Tier 1 léxico y pierde la búsqueda semántica — el
  sistema sigue respondiendo, peor.
- **Deepgram** (`app/streaming_transcription.py`) transcribe **en vivo, por WebSocket**, mientras la
  consulta ocurre. Sin él no hay transcripción y el Modo Fantasma se queda sin materia prima.

La **cascada** (`ATHOS_*_CASCADE`) hace que los tres proveedores de texto sean intercambiables en
caliente. Nació de un incidente real: el 31-jul la cuenta de Anthropic se quedó sin crédito y el
asistente se cayó entero mientras el chat clínico, que sí tenía cascada, siguió respondiendo.

**Hoy responde `deepseek-v4-flash` en las cuatro superficies**, así que DeepSeek es el proveedor
caliente, no Anthropic.

### 13–16 · Comunicaciones

- **Composio** guarda las conexiones de Gmail/Outlook/Calendar **en sus servidores**, no en nuestra
  base. Cada miembro conecta su propia cuenta. Al recrear la cuenta de Composio, **todos tienen que
  volver a conectar** — no es sólo cambiar una clave.
- **Resend** manda las facturas y el canal de cobranza por correo. Requiere verificar el dominio otra
  vez en la cuenta nueva.
- **Meta** y **Kapso** están cableados pero no en uso. Se pueden dejar sin recrear y quitar las
  variables; conviene decidirlo explícitamente en vez de arrastrarlas.

---

## Las variables que no son de ningún proveedor

Son nuestras, y **se generan nuevas** en el traspaso:

| Variable | Qué es | Cuidado |
|---|---|---|
| `CRON_SECRET` | Protege los crons y `/api/health` | Va en **Vercel Y en los secretos de GitHub Actions**. Cambiar sólo uno rompe los dos crons diarios |
| `WHATSAPP_TOKEN_KEY` | **Cifra** `whatsapp_integrations.access_token_enc` | 🔴 No es una API key: rotarla deja los tokens guardados indescifrables. Ver el bloque de rotación |
| `PLATFORM_ADMIN_EMAILS` | Allowlist de `/admin` | Sin ella no entra **nadie** al panel. Falla cerrado, que es lo correcto |
| `NEXT_PUBLIC_SITE_URL` | Origen canónico | Redirects de OAuth y enlaces de cobranza |
| `CARTERA_MESSAGING_SIMULATED` | Modo simulacro de cobranza | En producción debe estar **apagado**, o no sale ningún recordatorio y no deja síntoma |
| `ATHOS_TOPE_MENSUAL_POR_CLINICA` | Techo de gasto de IA | Vacío = 1000 llamadas/mes de contención. `"ninguno"` lo apaga |

---

## Cuánto hay que mover

**47 variables en el front, 23 en el backend.** El `.env.example` de cada uno dice qué se rompe si
falta — no hay que adivinarlo.

La comprobación de que no falta ninguna no es leer la lista: es que **`/api/health` responda
`missing: []`** con las credenciales del cliente puestas. Ese endpoint es la única fuente que sabe el
estado real, y el workflow `smoke` lo ejercita.

---

## Lo que falta decidir, y no es técnico

1. **Quién queda como titular de cada cuenta** — las dos columnas vacías de la tabla.
2. **Quién paga**, y con eso si Vercel sube de Hobby a Pro.
3. **Meta y Kapso**: ¿se recrean o se quitan del todo?
4. **El responsable del tratamiento de datos** — bloquea el lanzamiento, no el traspaso. Ver el
   bloque legal.

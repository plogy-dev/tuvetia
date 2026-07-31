# WhatsApp multi-tenant — capa de proveedor (Evolution principal · Meta plan B · Kapso legado)

Integración de WhatsApp por clínica detrás de una **capa proveedor-agnóstica**
(`src/lib/whatsapp/`): el transporte se elige por tenant con `whatsapp_integrations.provider`
(`'evolution'` | `'meta'` | `'kapso'`). El resto del sistema (bandeja, webhook parsers, Athos,
export, admin) habla un formato normalizado y no sabe qué transporte hay debajo.

> **Decisión vigente (2026-07-28, tarde):** transporte principal = **Evolution API * — sin trámite de Meta ni plantillas, QR dentro de tuvetia, sync completo del número. La única manera de hacer Sync con QR es con Evolution API, Balieys, WASENDER o similar, de lo contrario no es posible la vinculación con QR y el proceso tardaría más, debido al log in de meta.
> Riesgo de limitación de mensajes de cuentas por exceso de mensajes asumido con consentimiento explícito de la clínica y protecciones de
> comportamiento — TODO el detalle en **`docs/EVOLUTION.md`**. **Meta Cloud API directa** (Embedded
> Signup + coexistencia) queda construida como **plan B por tenant**: una clínica baneada migra al
> camino oficial en minutos sin perder datos. Kapso es legado en retirada.

## Arquitectura (2026-07-28)

| Pieza | Dónde |
|---|---|
| Capa de proveedor (`WhatsAppProvider`: sendText, refreshStatus; ruteo por tenant) | `src/lib/whatsapp/provider.ts` |
| Adaptador Kapso (envuelve `src/lib/kapso.ts`; muere al final de la migración) | `src/lib/whatsapp/kapso-provider.ts` |
| Adaptador Meta directo (`graph.facebook.com/v23.0`, token del tenant) | `src/lib/whatsapp/meta-provider.ts` |
| Cifrado de tokens (AES-256-GCM, env `WHATSAPP_TOKEN_KEY`) | `src/lib/whatsapp/crypto.ts` |
| Envío + registro del saliente (ÚNICO camino de salida; lo usan bandeja, Athos y modo auto) | `src/lib/whatsapp/send-message.ts` → `sendWhatsAppText()` |
| Verificación de webhooks (HMAC de Meta + shared secret legado, constant-time) | `src/lib/whatsapp/verify.ts` |
| Iniciar conexión Kapso (setup link hosteado, legado) | `POST /api/whatsapp/connect` |
| Cierre del Embedded Signup de Meta (code→token, register, subscribed_apps) | `POST /api/whatsapp/exchange` |
| Verificar conexión (proveedor del tenant; `disconnected` si el número se desvinculó) | `POST /api/whatsapp/status` |
| Webhook (GET = challenge de Meta; POST = inbound + statuses delivered/read/**failed**) | `/api/whatsapp/webhook` |
| UI de conexión (popup de Meta si hay `NEXT_PUBLIC_META_*`; si no, Kapso) | `src/components/settings/whatsapp-settings.tsx` |
| Bandeja de Comunicaciones | `src/components/whatsapp/inbox.tsx` |
| Plantillas UTILITY de citas (4, someter a aprobación de Meta) | `scripts/create-wa-templates.mjs` |

### Esquema (`whatsapp_integrations`, migraciones 0015 + 0018 + 0024)

`clinic_id` (unique) · `provider` ('kapso'|'meta') · `status` (pending/connected/disconnected) ·
`phone_number` · `kapso_customer_id` (nullable desde 0024) · `kapso_phone_number_id` (=
**phone_number_id de META** vía el proxy de Kapso) · `waba_id` · `meta_phone_number_id` ·
`access_token_enc` (cifrado app-level Y columna revocada para PostgREST) · `token_expires_at` ·
`setup_link_url` (legado). Mensajes: `whatsapp_messages` + `failed_at`/`error_detail` (0023).

### Webhook — seguridad y ruteo

- **Auth en orden**: (1) firma `X-Hub-Signature-256` + `META_APP_SECRET` (HMAC del body crudo);
  (2) header `x-webhook-secret` == `KAPSO_WEBHOOK_SECRET`; (3) query `?secret=` **DEPRECADO**
  (queda en logs de proxies) — re-registrar el webhook en Kapso con el header y borrar el fallback.
  Comparaciones constant-time.
- **GET** responde el challenge de Meta (`hub.mode/hub.verify_token/hub.challenge`,
  env `META_WEBHOOK_VERIFY_TOKEN`) — prerequisito para registrar el webhook en Meta directo.
- **Tenant por `value.metadata.phone_number_id`** contra `kapso_phone_number_id` /
  `meta_phone_number_id` (solo integraciones `connected`); fallback por `display_phone_number`
  exacto. **Sin heurísticas** de "única clínica" (era cross-tenant). Eventos sin clínica resoluble
  se loguean con `console.warn`, nunca se descartan en silencio.
- Statuses con scoping `clinic_id`; `failed` escribe `failed_at` + `error_detail` (la bandeja lo
  pinta en rojo con el motivo).

## Envs

| Env | Uso |
|---|---|
| `KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET` | transporte Kapso (legado) |
| `META_APP_ID`, `META_APP_SECRET` | app de Meta (exchange + firma del webhook) |
| `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID` | Embedded Signup en el front (activan el popup) |
| `META_WEBHOOK_VERIFY_TOKEN` | challenge GET del webhook |
| `META_REGISTER_PIN` | PIN de registro del número (default 000000) |
| `WHATSAPP_TOKEN_KEY` | 32 bytes base64 (`openssl rand -base64 32`) para cifrar tokens |
| `NEXT_PUBLIC_SITE_URL` | origin canónico (webhook de Evolution + redirect del setup link) |
| `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY` | Evolution API self-hosted (Railway — ver docs/EVOLUTION.md) |
| `EVOLUTION_WEBHOOK_TOKEN` | segmento secreto de la URL del webhook de Evolution (no firma sus webhooks) |
| `NEXT_PUBLIC_WA_PROVIDER=evolution` | activa el flujo de QR embebido en Configuración |
| `ATHOS_AGENT_PROVIDER` / `ATHOS_AUTO_PROVIDER` | `anthropic` \| `deepseek` (ruteo de modelos del agente; `DEEPSEEK_API_KEY` si aplica) |

## Trámite con Meta (admin, ~días-semanas; NO bloquea el desarrollo)

1. **Business Manager de tuvetia verificado** (documentos legales de la empresa).
2. **App de Meta** tipo Business con el producto WhatsApp; whitelistar el dominio; crear la
   **configuración de Embedded Signup** (→ `NEXT_PUBLIC_META_ES_CONFIG_ID`).
3. **App Review**: permisos `whatsapp_business_messaging` + `whatsapp_business_management`, con
   **2 videos demo** (onboarding embebido + envío/recepción dentro de tuvetia). Se puede grabar
   contra el **test WABA** (5 números verificados, sin App Review).
4. **Access verification** (Tech Provider). Hasta completar todo: límite de 10 clínicas
   onboardeadas/semana; después, 200.
5. Someter las plantillas: `node scripts/create-wa-templates.mjs --waba <WABA_ID> --provider meta`.
6. Coexistencia: requiere app WhatsApp Business ≥2.24.17; si el vet no abre la app en **14 días**,
   Meta corta la conexión API (por eso `status/route.ts` sabe marcar `disconnected`).

## Rollout de la migración

1. `provider='kapso'` default: las clínicas conectadas no cambian.
2. Con las envs `META_*` configuradas, el botón "Conectar" abre el **popup de Embedded Signup**
   (coexistencia, `featureType: whatsapp_business_app_onboarding`) → `/api/whatsapp/exchange`
   guarda `provider='meta'` + token cifrado y suscribe los webhooks.
3. Migrar una clínica piloto: desconectar en Kapso, reconectar por el popup (re-escanea QR;
   compartir historial de 6 meses es opcional del vet).
4. Cuando todas migren: borrar `src/lib/kapso.ts`, `kapso-provider.ts`, `connect/route.ts` y el
   fallback de secreto del webhook.

## Extensiones pendientes

1. **Media**: `media_url` no se persiste (los adjuntos aparecen como `[image]`); descargar media
   por la API y guardarla en Storage.
2. **Tiempo real**: el poll de 15 s de la bandeja puede pasar a Supabase Realtime.
3. **Escala**: normalizar `owners.phone` a E.164 (match hoy: últimos 10 dígitos).
4. **Ventana de 24 h**: enviar plantilla automáticamente cuando el texto libre falle fuera de
   ventana (las 4 plantillas de citas ya están definidas en `scripts/`).

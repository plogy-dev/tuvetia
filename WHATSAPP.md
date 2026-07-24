# WhatsApp multi-tenant (Kapso) — base + blueprint

Integración de WhatsApp por clínica usando **Kapso** (https://kapso.com): cada clínica se representa
como un **customer** de Kapso y conecta **su propio número** desde un **setup link hosteado** — modo
**coexistence** (escanea un QR con su app de WhatsApp Business y sigue usando el teléfono; los
mensajes se sincronizan con la Cloud API) o número dedicado. Kapso guarda las credenciales por
customer, aisladas: nosotros nunca tocamos tokens de Meta.

> **Ownership:** la **base** (conexión + webhook + tablas) está hecha (este doc). La **bandeja/inbox
> de Comunicaciones** la construye el otro dev encima de esto.

## Qué ya está construido (base)

| Pieza | Dónde |
|---|---|
| Tabla `whatsapp_integrations` (1 fila por clínica: `kapso_customer_id`, `phone_number`, `status pending/connected/disconnected`, `setup_link_url`) | migración `0015` (aplicada a prod). RLS: SELECT por clínica; **escrituras solo service_role** |
| Cliente Kapso (REST, server-only) | `src/lib/kapso.ts` — `createKapsoCustomer`, `createSetupLink`, `listPhoneNumbers` |
| Iniciar conexión (crea/reusa customer + setup link) | `POST /api/whatsapp/connect` (`src/app/api/whatsapp/connect/route.ts`) |
| Verificar conexión (marca connected + guarda el número) | `POST /api/whatsapp/status` |
| Webhook de mensajes (inbound + estados delivered/read) | `POST /api/whatsapp/webhook?secret=<KAPSO_WEBHOOK_SECRET>` — upsert idempotente en `whatsapp_messages` por `wa_message_id`, match de `owner_id` por teléfono, resolución de `clinic_id` por número receptor |
| UI de conexión | Configuración → sección **WhatsApp** (`src/components/settings/whatsapp-settings.tsx`) |

Sin config todo degrada con gracia: el botón devuelve el error legible y el webhook responde 503.

## Flujo del usuario (no técnico)

1. Configuración → **Conectar WhatsApp** → se abre la página hosteada de Kapso (en español).
2. Escanea el **QR** con su app de WhatsApp Business (coexistence) → sigue usando su teléfono.
3. Vuelve a `/dashboard/settings?whatsapp=connected` → se verifica y queda **Conectado · +57…**.
4. Desde ahí, los mensajes entrantes aterrizan en `whatsapp_messages` vía webhook.

## Config externa (una persona, ~15 min)

1. Cuenta en Kapso → crear proyecto → copiar la **Project API Key**.
2. **Vercel → env (Production):** `KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET` (string secreto propio).
   (`SUPABASE_SERVICE_ROLE_KEY` ya requerida por calendario/ICS.)
3. En Kapso, registrar el webhook apuntando a
   `https://<dominio>/api/whatsapp/webhook?secret=<KAPSO_WEBHOOK_SECRET>` en modo **meta** (reenvío
   crudo del payload de la Cloud API — es el formato que parsea nuestro receiver).

## API de Kapso usada (verificada contra docs.kapso.ai)

- Base: `https://api.kapso.ai/platform/v1` · Auth: header `X-API-Key`.
- `POST /customers` `{customer:{name, external_customer_id}}` → `data.id` (usamos `clinic_id` como
  `external_customer_id`).
- `POST /customers/{customer_id}/setup_links` `{setup_link:{success_redirect_url,
  allowed_connection_types:["coexistence","dedicated"], language:"es"}}` → `data.url` (expira a 30 días).
- `GET /phone-numbers` → números del proyecto (se filtra por `customer_id` del lado nuestro).

## Lo que le toca al otro dev (bandeja / Comunicaciones)

1. **UI de bandeja** en `/dashboard/comunicaciones` sobre `whatsapp_messages` (agrupar por
   `owner_id`/`wa_phone_from`, orden por `created_at`). El link del sidebar hoy apunta a `#`.
2. **Enviar mensajes**: Kapso expone envío por su API (`whatsapp-cloud-api` SDK o REST) — usar el
   número de la clínica; registrar el saliente en `whatsapp_messages` (`direction='outbound'`,
   `sent_by`) para que los `statuses` del webhook actualicen `delivered_at/read_at`.
3. **Policy UPDATE** en `whatsapp_messages` (hoy solo SELECT+INSERT) si la bandeja marca leído desde
   el cliente; alternativa: RPC o route service_role.
4. **Afinar contra el OpenAPI de Kapso** (`docs.kapso.ai/api/platform/v1/openapi-platform.yaml`):
   confirmar el campo `customer_id` en `GET /phone-numbers` y el mecanismo oficial de firma del
   webhook (hoy: shared secret por query param — subir a firma si Kapso la ofrece).
5. **Escala**: el match de titular es por últimos 10 dígitos del teléfono; considerar normalizar
   `owners.phone` a E.164. `agent_mode` (auto/review/paused) ya existe en el esquema para el futuro
   agente de IA sobre WhatsApp.

## Por qué Kapso (decisión)

- **Multi-tenant nativo**: 1 clínica = 1 customer, credenciales aisladas por Kapso; escala a miles de
  tenants sin que gestionemos tokens de Meta ni verificación de números.
- **QR + coexistence**: la clínica sigue usando su teléfono — fricción mínima para no técnicos.
- **Sin lock-in de datos**: los mensajes viven en NUESTRA tabla (`whatsapp_messages`) vía webhook.

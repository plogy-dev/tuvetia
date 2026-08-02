# Plan de remediación — Auditoría 2026-07-30

> Auditoría completa del 30-jul (UI de facturación del PR #36, cascada de IA, CI/cron, logs de
> Supabase del principal, documentos de entrega). Este documento es el plan **y su estado de
> ejecución**: casi todo entró en la rama `fix/auditoria-2026-07-30`; lo que requiere una acción
> humana está marcado 👤. Detalle de cada hallazgo: mensajes de commit de esa rama.

## El hallazgo que ordena todo lo demás

Las tres garantías que el pipeline verde decía dar no se estaban dando: el cron de cartera **nunca
corrió** (faltaba `CRON_SECRET` en Actions, 6/6 en rojo sin que nadie lo viera), el Smoke E2E
**saltaba en silencio** su único chequeo de configuración y reportaba verde, y los tests
**cross-tenant nunca se ejecutaron** (se auto-skipeaban sin DB) mientras tres documentos los
citaban como garantía cumplida.

---

## Ola 0 — Operación ✅ (código) / 👤 (secreto)

| # | Qué | Estado |
|---|---|---|
| 0.1 | 👤 **Crear `CRON_SECRET` en GitHub** (Settings → Secrets and variables → Actions), mismo valor que la env de Vercel | ✅ **HECHO** (2026-07-31 16:55). Verificado el 01-ago: `gh run list` muestra Cartera sweep y Smoke E2E **verdes en schedule**, sin skips |
| 0.2 | El smoke **falla** (no salta) en CI sin el secreto, con mensaje de dónde definirlo | ✅ `e2e/smoke.e2e.ts` |
| 0.3 | Un schedule rojo abre/comenta un **issue** (antes: invisible — 6 fallos sin que nadie los viera) | ✅ `cartera-sweep.yml`, `smoke.yml` |
| 0.4 | Cadencia real documentada: GitHub disparó ~1/80 min, no cada 15 — es el piso pedido, no garantía | ✅ workflow + INVENTARIO |

## Ola 1 — Facturación: críticos ✅

| # | Qué | Estado |
|---|---|---|
| 1.1 | Editar el gasto A y luego el B ya no guarda los importes de A sobre B (`key={id}` — formularios no controlados que React reconciliaba) | ✅ `finanzas/page.tsx` |
| 1.2 | Enlaces del puente CRM: `/app/crm/*` y `/app/athos/*` (repo del cliente, 404 aquí) → `/dashboard/patients/*` y `/dashboard/consultas/*` | ✅ `[id]/page.tsx` |
| 1.3 | Emisión **idempotente**: el reintento reutiliza el borrador (antes: un huérfano por clic) + enlace al borrador en el error. Igual en compras, donde el error de confirmación ya no se lo tragaba la navegación | ✅ `InvoiceCart`, `PurchaseForm` |
| 1.4 | Confirmación en todo lo destructivo: borrar egresos/ingresos, borrar/reabrir/anular compras, y **"Ejecutar seguimiento ahora"** (contacta deudores de verdad, Ley 2300) | ✅ 4 componentes |
| 1.5 | `Math.round(cents/100)` al editar → división exacta + `step="any"`: guardar sin tocar nada ya no cambia el importe | ✅ 4 sitios |
| 1.6 | KPIs del home sobre **agregados de todo el historial** (`getDashboardKpis`, paginado al max-rows de PostgREST), no sobre las últimas 100 filas; frontera de mes en Bogotá, no en UTC | ✅ `page.tsx`, `queries.ts` |

## Ola 2 — Cascada de IA ✅ (código) / 👤 (encendido)

| # | Qué | Estado |
|---|---|---|
| 2.1 | `clinical_notes.ai_model` y el `done` del chat registran **quién respondió** (`cascade.usado`/`modelo_usado`), no `LLM_MODEL` fijo | ✅ `provider_cascade`, `phantom`, `chat` |
| 2.2 | Lista blanca `{openai, google, anthropic}`: un typo `@gemini` ya no manda la key de DeepSeek al SDK de Anthropic | ✅ |
| 2.3 | Candidato sin key se descarta (era un 401 garantizado que tapaba el error real del primario); al agotar la cadena se loguean los N errores | ✅ |
| 2.4 | Respuesta vacía / solo-razonamiento / cortada por `max_tokens` / stream sin `[DONE]` **levanta** (`RespuestaVaciaError`) → la cascada actúa; el reintento medido de `generate_note` se conserva | ✅ `llm_client`, `generate` |
| 2.5 | El test de "el cuerpo al primario no cambió" ahora **mira el cuerpo** (assert de `thinking`); `_sin_red` levanta `BaseException` — y al activarlo **destapó una fuga real** (llamada a Cohere sin mockear en `test_chat`, tapada por el fail-open del Tier 2) | ✅ + fuga corregida |
| 2.6 | `GEMINI_MODEL`/`GEMINI_LIGHT_MODEL` eliminadas (config muerta que nadie leía, citada como evidencia) | ✅ `config.py`, `.env.example`, docs |
| 2.7 | 👤 **No encender `LLM_CASCADE_*` en Railway** hasta mergear esta rama; después, encender es agregar la variable | Regla operativa |
| 2.8 | La cascada cubría el RAG (Python) pero **no la capa agéntica** (Next). Se descubrió el 31-jul cuando Anthropic se quedó sin crédito: el chat clínico siguió respondiendo y el asistente cayó entero | ✅ `4e45c00` — misma idea portada a TypeScript |
| 2.9 | Extendida a las **tres** superficies del agente (`ATHOS_AGENT_CASCADE`, `ATHOS_AUTO_CASCADE`, `ATHOS_VISION_CASCADE`): una caída de Anthropic ya no tumba la autorespuesta de WhatsApp ni el OCR de facturas | ✅ 01-ago |
| 2.10 | El `modelId` que se persiste lo reescribe la cascada al caer al respaldo — antes decía que respondió el primario aunque contestara el respaldo. **Es el mismo defecto que 2.1, repetido en el front** | ✅ `57005b1` |
| 2.11 | `"rate"` a secas hacía match dentro de `"generated"`: un error NUESTRO disparaba el respaldo y pagaba una segunda llamada entera | ✅ `57005b1` |
| 2.12 | `/api/health` exige la credencial de **cada** proveedor nombrado en las cadenas: un respaldo sin key no protege de nada y daba falsa tranquilidad | ✅ `88c0295` |

### La revisión de código del 01-ago: 15 defectos, 13 cerrados ✅

Se revisó la cascada de TypeScript a fondo. `57005b1` y `88c0295` cerraron 4 (son 2.10–2.12);
`0fd5964` cerró los **9 restantes que son de Athos**, más uno que apareció al verificar.

| # | Qué | Estado |
|---|---|---|
| 2.13 | El clasificador miraba SÓLO el mensaje por subcadenas. El AI SDK arma `APICallError` con el mensaje pelado del proveedor, sin el estado: un 401 de clave revocada llega como `invalid x-api-key`, que no contiene «api key» (lleva guiones) ni «401» | ✅ `clasificarFallo` mira `statusCode` y `responseBody`. **Verificado contra la API real: el saldo agotado de Anthropic llega con estado 400**, no 401 ni 402 — por eso el saldo se evalúa ANTES que el estado |
| 2.14 | El bucle son **8 pasos** y «nunca a mitad de respuesta» valía por paso: agotarse el saldo en el paso 3 dejaba la nota cosida de dos modelos | ✅ el proveedor queda FIJADO por respuesta |
| 2.15 | Sin lista blanca, un typo (`@deepsek`) mandaba todo a Anthropic en silencio | ✅ `PROVEEDORES` explícito; los eslabones inválidos se descartan con aviso |
| 2.16 | La taxonomía de errores estaba duplicada en `route.ts` y **ya se había desincronizado**: el arreglo de "rate limit" entró en `cascada.ts` y la copia de la ruta quedó vieja | ✅ una sola función, dos consumidores |
| 2.17 | `maxRetries` envuelve la cascada por fuera: una caída total reproducía la cadena entera 3 veces | ✅ el error final sale con `isRetryable: false` |
| 2.18 | Un error no-proveedor en un RESPALDO abortaba la cadena entera | ✅ sólo corta si falla así el primario |
| 2.19 | Los fallos de respaldo no se registraban: no había cómo distinguir «también caído» de «nunca configurado» | ✅ log por intento con su clase de fallo |
| 2.20 | Los respaldos se casteaban sin validar → `m.doStream is not a function` tapando el error real | ✅ se validan al armar la cadena |
| 2.21 | Los ejemplos ponían Anthropic primero, que es lo que `provider_cascade.py` prohíbe sin crédito | ✅ DeepSeek primero, con la nota de cuándo invertirlos |
| 2.22 | **`deepseek-v4` NO EXISTE** — apareció al verificar contra la API. Estaba como default en `model.ts` y tarifado en `/admin/costos`; bastaba `ATHOS_AGENT_PROVIDER=deepseek` sin fijar modelo para que reventara | ✅ `deepseek-v4-flash` en defaults y ejemplos; la tabla de precios lista los dos nombres reales |

Quedan 2, y **no son de Athos**: el tour de onboarding que se rompe con la barra colapsada, y las
dos copias sobrevivientes de la regla de ruta activa (`site-header.tsx`, `athos-sidebar-section.tsx`).

> **El patrón que conviene no repetir.** 2.10 y 2.15 son defectos que las Olas 2.1 y 2.2 **ya habían
> resuelto en Python**, y el port a TypeScript los reintrodujo. Antes de seguir tocando el front,
> leer `provider_cascade.py` entero.
>
> Y sobre las pruebas: las de la primera versión **pasaban en verde inventando mensajes** como
> `"401 Unauthorized"` que el SDK nunca produce. Ahora construyen `APICallError` con el estado y el
> cuerpo reales. Una prueba que fabrica su propia entrada no prueba nada.

## Ola 3 — Documentos de entrega ✅ (antes de la reunión del ~3-ago)

- `ESTADO-MILESTONE2`: resuelta la triple contradicción de facturación (§4.7 "construida" vs §7.2
  "sin interfaz" vs tabla P2 "5–7 semanas"); retirada la frase "esos 257 casos ahora respaldan una
  interfaz que existe" (non sequitur: prueban `domain/`, la UI entró sin tests); `GEMINI_MODEL` ya
  no se cita como evidencia; cifra de tests recontada con la salvedad de los skips.
- `INVENTARIO-COMPONENTES`: la fila del cron dice el estado real (6/6 en rojo, secreto solo en
  Vercel, cadencia ~1/80 min, correo de salida ya cableado).
- `ESTADO.md`: "las rutas no existen" → existen desde `bfd5150`.
- `AGENT-SMOKE-TESTING`: la referencia a los cross-tenant cuenta su historia y desde cuándo corren.

## Ola 4 — Red de seguridad ✅

| # | Qué | Estado |
|---|---|---|
| 4.1 | **Los cross-tenant CORREN en CI**: Postgres pgvector en `services:` + shim Supabase (`.github/ci/athos-db-shim.sql`) + bootstrap + 0001-0003. Secuencia verificada localmente contra `pgvector:pg16`: los 4 de aislamiento/gate pasan | ✅ `ci.yml` |
| 4.2 | La suite de pytest **se niega a arrancar** si `DATABASE_URL` apunta al principal (los logs de prod registraron los ids de fixture `"clinic-a"` — pytest corrió contra producción y `seeded_tenants` siembra/borra clínicas). 👤 Coordinar con infinitysky2704 que su `.env` apunte a `tuvetia-athos-dev` | ✅ guard / 👤 coordinación |
| 4.3 | Primeros tests del módulo de dinero fuera de `domain/`: `page-auth` (el control de acceso de las 16 páginas) y las dos guardas de xlsx (7 casos) | ✅ |
| 4.4 | `/api/health` chequea además: `CARTERA_MESSAGING_SIMULATED` (cobranza en simulacro = fallo silencioso), la key del proveedor **real** del agente (`DEEPSEEK_API_KEY` si aplica), `META_WEBHOOK_VERIFY_TOKEN` | ✅ |

## Ola 5 — Medios de facturación + DB ✅ (código) / 👤 (aplicar migración)

Incluye: guard en `/inventario/importar` (la única de 16 sin él); sanitización del `.or()` de la
búsqueda de titulares (inyección de filtros PostgREST); fechas ancladas a Bogotá
(`defaultDueDate`, vencimientos de `issueInvoice`); `followupEnabled` respeta
`settings.reminders_enabled`; avisos del servidor visibles al guardar borrador; resultados de
server actions ya no se descartan (`CatalogItemsTab`, `HumanTasksPanel`); `RecipeEditor` con
`catch/finally` y sin mutación de estado; popup del comprobante abierto dentro del gesto del
usuario; **CSV injection neutralizada** en las dos exportaciones (+test); exportación rotulada
"esta página"; sandbox con una sola fuente de verdad (`numbering_ranges.is_sandbox`); `SettingsForm`
ya no borra `department_code` ni pisa UVT; EXENTO ≠ Excluido en el documento fiscal; borrados
`InventoryForms.tsx` (246 líneas sin importadores) y 4 server actions sin consumidor.

- **Migración `0045_facturacion_db_hardening.sql`** (renumerada dos veces: nació 0042 y pasó por
  0043; la tanda de calendario se llevó ambos números el 31-jul): `search_path` fijo en
  `facturacion_assign_next_number` y `touch_updated_at` + 21 índices de FK (facturación/equipo).
  Validada contra la cadena completa de migraciones en local. 👤 **Aplicar al principal** con el
  flujo de siempre (dev → PR → principal, `MIGRACIONES.md`) — no se aplicó automáticamente.
  **APLICADA — verificado el 2026-08-02** contra el esquema del principal: las dos funciones
  tienen `proconfig` con el `search_path` fijo y los 21 índices están presentes.

### ✅ Las tres migraciones están aplicadas al principal — verificado 2026-08-02

Consultado el esquema del principal (`auxlnexhkmtoedrzfsnz`) directamente, no leído de un documento:

| Migración | Qué hace | Verificación |
|---|---|---|
| `0044_realtime_whatsapp_messages` | Publica `whatsapp_messages` en `supabase_realtime`. La publicación existía pero estaba **vacía**, así que ninguna suscripción emitía nada, en silencio | ✅ publicada · **RLS sigue activa** y la policy SELECT está presente, que es lo que impide que una clínica reciba los mensajes de otra |
| `0045_facturacion_db_hardening` | `search_path` + 21 índices de FK | ✅ **2/2** funciones con `search_path` fijo · **21/21** índices presentes |
| `0046_athos_agent_usage` | Tabla de uso del agente de Next, con `tokens_in`/`tokens_out` reales | ✅ tabla con RLS, 1 policy, 4 índices, 10 columnas |

> **La duda de la renumeración queda cerrada.** La de facturación se renumeró de `0043` a `0045`
> porque la tanda de calendario se llevó ese número, y quedaba por confirmar que la `0043` de
> calendario no hubiera quedado saltada por la colisión. **No lo quedó:** la `0042` creaba el índice
> `appointments_clinic_google_event_uidx` como PARCIAL (`where google_event_id is not null`) y la
> `0043` lo corrige a TOTAL. En el principal el índice es total, o sea que la `0043` corrió.

⚠️ **`0044` falta en DEV**, al revés del flujo normal: se aplicó primero al principal porque el
diagnóstico se hizo ahí (`pg_publication_tables` devolvía cero filas el 31-jul). Conviene aplicarla
a dev para que los dos entornos no diverjan.

## Pendientes que quedan fuera de esta rama

1. ~~👤 `CRON_SECRET` en Actions (0.1)~~ — ✅ hecho el 31-jul; sweep y smoke corren verdes.
2. 👤 Decisión sobre las 20 funciones `SECURITY DEFINER` ejecutables por `authenticated`
   (`accept_invitation`, `remove_clinic_member`, `switch_active_clinic`…): revisar cuáles son
   intencionales y revocar el resto. Y activar la protección de contraseñas filtradas (dashboard
   de Supabase → Auth).
3. Verificación en caliente del módulo de facturación con datos reales de una clínica (lo pide el
   propio ESTADO-MILESTONE2).
4. Backlog de bajos de la auditoría (B1–B32 de facturación: accesibilidad de `TrLink`,
   `FinanceBars` con meses vacíos, doble conteo stock bajo/agotado, etc.).
5. Tests e2e autenticados (ningún flujo con sesión está probado en ninguna capa).

## Verificación

- Front: `npx tsc --noEmit` ✅ · `npm run lint` ✅ (0 errores) · `npm test` ✅ · `npm run build` ✅.
- Backend: `ruff` ✅ · `pytest` ✅ (233 casos; con DB local corren también los de integración).
- CI: la primera corrida del PR ejercita el job con Postgres; tras 0.1, `gh workflow run` de sweep
  y smoke deben salir verdes y el smoke sin skips.
- Tras aplicar **0045** (era 0042 cuando se escribió esto): re-correr los advisors de Supabase —
  deben desaparecer `function_search_path_mutable` de facturación y las 21 FKs sin índice.
- Tras aplicar **0044**: `scripts/verificar-realtime.sql` debe devolver la fila de
  `whatsapp_messages` en `pg_publication_tables`. Hoy la publicación está vacía.

## Estado al 2026-08-01, 18:30

Verificado contra `origin/master` en `a98dc8c`, no contra los mensajes de commit:

| | |
|---|---|
| Suite del front | ✅ 388 pruebas, 37 archivos |
| Tipos | ✅ `tsc --noEmit` sin errores |
| Producción (Vercel) | ✅ raíz 200 · `/dashboard` 307 · agente 401 (exige sesión) |
| Backend RAG (Railway) | ✅ `{"status":"ok","service":"athos"}` |
| Variables en Vercel | ✅ 23 en producción |
| Cron de cartera y smoke | ✅ verdes en schedule desde el 31-jul |

**Lo que falta es operación, no desarrollo:** recargar el saldo de Anthropic y rotar las
credenciales que pasaron por chat. Las tres migraciones ya están aplicadas (verificado 02-ago) y
2.13/2.14 se cerraron en `0fd5964`, así que la rotación ya no tumba el asistente.

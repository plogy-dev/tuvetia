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
  **Sigue sin aplicar al 2026-08-01**: los advisors del principal todavía reportan
  `function_search_path_mutable` en las dos funciones.

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
- Tras aplicar 0042: re-correr los advisors de Supabase — deben desaparecer
  `function_search_path_mutable` de facturación y las 21 FKs sin índice.

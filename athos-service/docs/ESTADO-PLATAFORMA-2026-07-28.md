# Auditoría de la plataforma — 2026-07-28

> Foto completa del sistema tal como está HOY en producción, hecha antes de pushear nada, para que
> el trabajo de Athos no choque con los cambios grandes que entraron por otro lado.
> Todo lo de acá se verificó **contra la base de producción** (`auxlnexhkmtoedrzfsnz`, us-west-2),
> sólo lectura, salvo lo que se indique.

> **ACTUALIZACIÓN 2026-07-29 — gran parte de esta foto quedó saldada al día siguiente.** El push
> que faltaba llegó (PRs #23–#28 en `master`): la tanda entró al repo **renumerada como
> `0026`–`0036`** (el choque de numeración se resolvió a favor nuestro: `0022`–`0025` siguen siendo
> las de multi-clínica/logos/evidence_level; la próxima arranca en `0037`, ver `ESTADO.md` raíz),
> `athos_actions` **ya tiene su ciclo completo** (agente en `src/lib/athos-agent/` que propone con
> `service_role`; aprobación/edición/ejecución bajo la sesión del vet en
> `/api/athos/actions/[id]/execute|reject`, con tarjetas de aprobación en la UI) y el backend ganó
> `POST /athos/retrieve` como herramienta de evidencia del agente. Los entrantes de WhatsApp ahora
> pasan por un punto único (`src/lib/whatsapp/inbound-router.ts`). **Siguen vigentes:** el front no
> lee `evidence_level` (§El front), el multi-clínica a medio cablear, y la concurrencia en Micro.
> El resto del documento se conserva como foto histórica del 2026-07-28.

## El hallazgo que ordena todo lo demás

**El esquema de producción y el repositorio divergieron.** La base tiene **56 tablas**; el repo
declara **28** (19 en `supabase/bootstrap/000_base_schema.sql` + 9 en `supabase/migrations/`).
Las 31 restantes —una capa completa de facturación, inventario, compras y comunicaciones, más
`athos_actions`— **se aplicaron directamente a la base y no existen como SQL ni como código en
`plogy-dev/tuvetia`**. `origin/master` no tiene commits nuevos.

Consecuencia práctica: **`supabase/migrations/` ya no describe producción.** Sirve para *nuestros*
cambios, no como retrato del esquema. Cualquiera que lea el repo para saber qué hay en la base se va
a equivocar.

Cómo se midió: dev (`ghmpjyuchwkrvnjvdeum`) se bootstrapeó del mismo esquema base y sólo recibió
nuestras migraciones, así que la diferencia prod−dev es (casi exactamente) lo que entró por fuera.

| objeto | producción | dev | sólo en producción |
|---|---|---|---|
| tablas | 56 | 25 | **31** |
| columnas | 701 | 272 | **429** |
| enums | 34 | 28 | 6 |
| funciones | 114 | 97 | 18 |
| triggers | 20 | 0 | **20** |
| políticas RLS | 164 | 55 | 109 |
| índices | 161 | 48 | 114 |

Las 8 funciones con "definición distinta" son overloads de pgvector (`sparsevec`/`halfvec`): es una
diferencia de versión de la extensión entre proyectos, no un cambio del equipo.

## HASTA DÓNDE LLEGÓ EL CAMBIO (evidencia del historial de migraciones)

El principal registra cada migración en `supabase_migrations.schema_migrations` **con su SQL
completo**. Ahí está la respuesta exacta: el equipo aplicó **11 migraciones, `0022`–`0032`**, entre
las **2026-07-28 22:01 UTC** y las **2026-07-29 03:18 UTC**.

| versión | nombre | qué hizo |
|---|---|---|
| 20260728220139 | `0023_whatsapp_message_failed_status` | `whatsapp_messages.failed_at` + `error_detail` |
| 20260728220155 | `0022_security_hardening` | cierra `corpus_chunks` a PostgREST, revoca SECURITY DEFINER de anon/PUBLIC |
| 20260728221612 | `0024_whatsapp_provider_meta` | capa de proveedor (kapso → meta), token cifrado |
| 20260728222842 | **`0025_athos_actions`** | enum + tabla de acciones propuestas por Athos |
| 20260728222852 | `0026_clinic_hours` | horarios de atención por clínica |
| 20260728223656 | `0027_whatsapp_auto_mode` | `agent_mode` + `auto_daily_limit` |
| 20260728230029 | `0028_whatsapp_evolution_provider` | proveedor `evolution` + consentimiento no oficial |
| 20260729031634 | `0029_facturacion_core` | núcleo de facturación |
| 20260729031740 | `0030_facturacion_cartera` | cartera/recaudo (motor Ley 2300) |
| 20260729031818 | `0031_facturacion_catalogo_inventario` | catálogo e inventario |
| 20260729031857 | `0032_facturacion_compras_gastos` | compras, proveedores y gastos |

**La base llegó completa hasta `0032`. El repositorio no recibió nada.** Los propios comentarios de
las migraciones dicen *"ver header completo en el archivo del repo"* y *"adaptación de
`0021_facturacion_core` **del repo origen**"*, pero esos archivos **no están en
`plogy-dev/tuvetia`**: `origin/master` sigue en nuestro último commit. O sea que **lo que se cortó
fue el push del código, no la aplicación del esquema**: el SQL y el front viven todavía en su
máquina.

### ⚠️ Choque de numeración: `0022`–`0025` existen DOS veces

| nº | nuestra | suya |
|---|---|---|
| 0022 | `multi_clinic_memberships` | `security_hardening` |
| 0023 | `clinic_logos_storage` | `whatsapp_message_failed_status` |
| 0024 | `clinic_logos_select_policy` | `whatsapp_provider_meta` |
| 0025 | `clinical_notes_evidence_level` | `athos_actions` |

Cuando él pushee su carpeta `supabase/migrations/`, los nombres van a colisionar con los nuestros.
**Hay que acordar la numeración antes de que ninguno de los dos pushee.** Sugerencia: que nuestras
migraciones del RAG salten a un rango propio (p.ej. `1001+`) y dejar `00xx` para la plataforma.

Detalle adicional: **nuestra `0025_clinical_notes_evidence_level` NO figura en el historial** porque
la apliqué a mano con psycopg, no con el CLI. Es idempotente (`add column if not exists` + drop/add
del constraint), así que un `supabase db push` posterior no rompe nada, pero el registro del
principal no la conoce.

### Piezas que quedaron colgando dentro de lo que sí entró

1. **`athos_actions` no tiene el trigger `touch_updated_at`.** Todas las tablas nuevas de
   facturación lo tienen; ésta no, porque se creó en `0025` y la función `touch_updated_at()` recién
   se creó en `0029`. Su `updated_at` nunca se va a actualizar solo.
2. **`comm_messages.wa_conversation_id` apunta a una entidad que no existe**: no hay tabla
   `wa_conversations` ni FK. Es un resto del port desde el repo origen.
3. **`athos_actions` no tiene ruta de aprobación**: sólo política de `SELECT`, sin RPC para
   aprobar/rechazar/ejecutar. La mitad humana del ciclo no está construida.
4. **Cero UI**: el front no referencia ninguna de las 31 tablas.

### Lo que el hardening (`0022`) hizo con lo nuestro — verificado

- `corpus_chunks` quedó con **RLS habilitada y 0 políticas**, y sus permisos quedan **sólo para
  `service_role`** (se revocó `anon`/`authenticated`). Athos entra por psycopg con `service_role`,
  que se salta RLS: **no nos afecta**, y de hecho cierra un agujero real (el corpus estaba expuesto
  por PostgREST). Su propio comentario lo razona igual.
- `glossary_term` / `glossary_synonym` conservan su política de lectura para `authenticated`.
- Verificado en vivo después del cambio: el retrieval completo corre y da hit@15 83,6%.

## Qué entró exactamente

### Capa de facturación y cobranza (no existía)
`invoices` (32 columnas), `invoice_lines`, `invoice_events`, `invoice_reminders`, `credit_notes`,
`payments`, `payment_applications`, `billing_payers`, `billing_settings` (26 columnas),
`numbering_ranges`, `fiscal_documents`. Función `facturacion_assign_next_number(p_range_id uuid)`.

### Inventario y compras (no existía)
`catalog_items` (30 columnas), `catalog_categories`, `catalog_lots`, `inventory_movements`,
`purchases`, `purchase_items`, `suppliers`, `expenses`, `receipt_attachments`, `import_batches`,
`service_consumptions`. Bucket de storage nuevo: `receipts` (privado).

### Comunicaciones de cobranza (no existía, y NO reemplaza nuestro WhatsApp)
`comm_messages`, `channel_authorizations`, `human_tasks`, `clinic_hours`.

Es un sistema **orientado a facturación**, no clínico: `comm_messages` tiene `invoice_id`,
`payer_id` y `authorization_id`; `human_tasks.kind` es `VERIFICAR_COMPROBANTE | DISPUTA |
SOLICITUD_PLAZO | CONTACTO_SOLICITADO | MENSAJE_NO_ENTREGADO`. Nuestras `whatsapp_integrations` /
`whatsapp_messages` (migraciones 0015/0018, que usa `app/whatsapp_reply.py`) siguen siendo el canal
**clínico** y no fueron tocadas.

> **Riesgo de coordinación, no de ruptura:** los dos sistemas pueden mandar WhatsApp al mismo
> titular por vías distintas. Hay que decidir quién manda antes de que ambos estén vivos.

Detalle de convención: esta capa usa constantes en **español y mayúsculas** (`EN_COLA`, `SALIENTE`,
`ABIERTA`) mientras el resto del esquema usa enums en inglés minúscula. Es la huella de que viene de
otro código base (el repo forkeado).

### `athos_actions` — lo que más nos toca

Tabla nueva, **vacía**, diseñada para que **Athos proponga acciones y un humano las apruebe**:

```
tool_name, payload jsonb, summary, proposed_by_model
risk    : 'auto' | 'approval'                (default 'approval')
source  : 'chat' | 'inbox' | 'auto'
status  : proposed | approved | rejected | executed | failed | expired
reviewed_by, reviewed_at, executed_at, result jsonb, error
expires_at (default now() + 7 días)
```
Índices: `(clinic_id, status, created_at desc)` → bandeja de pendientes por clínica;
`(clinic_id, conversation_key, status)` → acciones dentro de una conversación.

**Política RLS: sólo `SELECT`.** Es la única tabla nueva sin políticas de insert/update/delete —
todas las demás tienen CRUD completo para `authenticated`. Eso dice algo concreto del diseño: **el
escritor previsto es un backend con `service_role`, es decir NOSOTROS**, y el front sólo lee. La
ruta de aprobación todavía no existe (no hay RPC para aprobar/ejecutar).

**Nuestro `athos-service` no la conoce.** Es la brecha de alineación más importante y es una
decisión de producto, no algo que corresponda implementar por cuenta propia.

## Qué NO cambió (la buena noticia para Athos)

Las tablas que Athos lee o escribe **no fueron modificadas estructuralmente**. Lo único que se les
agregó desde afuera:

- `owners.id_doc_type` (text) — para facturación.
- `profiles.setup_completed_at` (timestamptz) — onboarding.

Todo lo demás que aparece como "nuevo" en esas tablas es nuestro: `clinical_notes.alerts` (0004),
`clinical_notes.evidence_level` (0025), `consents.owner_scope`/`revoked_at` (0020),
`profiles.onboarded_at` (0013), los índices de hot-path (0014/0020) y los guards de `profiles` (0021).

Los índices que sostienen el retrieval están intactos: `corpus_chunks_embedding_idx` (HNSW,
m=16 ef_construction=64), `corpus_chunks_mesh_gin`, `corpus_chunks_tsv_idx`, `corpus_chunks_metadata_idx`.
pgvector 0.8.0.

Los 20 triggers nuevos son 18 `touch_updated_at` sobre tablas nuevas + los dos guards de `profiles`
que son nuestros. **Ninguno dispara sobre `clinical_notes`, `consultations`, `transcripts` ni
`patients`**, así que el Fantasma no tiene efectos colaterales inesperados.

## Estado real de los datos (qué está vivo y qué está construido pero apagado)

**34 de las 56 tablas están vacías.** Toda la capa de facturación, inventario, compras y
comunicaciones existe pero **todavía no se usa**. `athos_actions`: 0 filas.

Lo que sí está vivo: 11 clínicas, 37 pacientes, 50 consultas, 35 notas clínicas, 46 transcripciones,
56 embeddings de paciente, 61 mensajes de Athos, 71 recuperaciones logueadas.

Máquinas de estado en uso real:
- `consultations.status`: `completed=20, open=15, review=15`. **Nunca se ven `transcribing` ni
  `generating_note`**: o son instantáneos o el front no los escribe.
- `clinical_notes.status`: `approved=20, draft=15` → el flujo de aprobación humana funciona.

**Athos no escribe `consultations.status`** (sólo lee `patient_id` y `chief_complaint`). Lo maneja el
front: escribe `"review"` y `"completed"`. No hay conflicto, pero conviene saberlo: si algún día se
espera que Athos avance el estado, hoy no lo hace.

## Multi-clínica: declarado, no cableado

`memberships` (nuestra, migración 0022) tiene 13 filas, pero **`private.my_clinic_id()` sigue
leyendo `profiles.clinic_id`**, es decir UNA sola clínica por usuario:

```sql
select clinic_id from public.profiles where id = auth.uid()
```

Y **ningún usuario tiene más de una clínica** hoy. Conclusión: el multi-clínica está a medio camino;
quien asuma que `memberships` gobierna el acceso se va a equivocar. Athos no depende de esto (usa
`service_role` con `clinic_id` explícito), pero es una trampa para el resto.

## El front

El código del front **no tiene noticia de ninguna de las 31 tablas nuevas** — ni lectura, ni
escritura, ni tipos. Consulta 22 tablas, todas del esquema viejo. No hay archivo de tipos generados
de Supabase, así que **el desajuste es silencioso**: nada falla en build, simplemente no hay UI.

Consume Athos desde el navegador vía `NEXT_PUBLIC_ATHOS_URL` (`src/lib/athos.ts`) con el JWT de
Supabase. CORS en Railway permite `https://tuvetia.vercel.app` y `localhost:3000`; el dominio
responde 200.

### Dos desalineaciones concretas del front con lo que ya entregamos

1. **`evidence_level` no se usa.** La migración 0025 está aplicada y el backend ya devuelve la banda
   (`none | limited | sufficient`), pero el front no lo lee.

2. **Peor: infiere la evidencia contando citas.** En
   `src/app/dashboard/consultas/[id]/page.tsx:306` hace
   `citations.length > 0 ? "Evidencia suficiente" : "Sin literatura citada"`.
   **Ese proxy está medido y es falso**: el número de citas verificadas tiene mediana **6,0 tanto
   cuando la literatura cubre la consulta como cuando no** (banco de 187 casos). O sea que hoy la UI
   afirma "Evidencia suficiente" apoyada en la única señal que demostramos que no discrimina.
   El campo correcto ya existe y viaja en el payload.

3. Menor: `src/components/athos/consultation-thread.tsx:65` descarta `insufficient_evidence` del
   evento `done` (sólo toma `citations`).

## Riesgos abiertos y coordinación necesaria

1. **Numeración de migraciones: `0022`–`0025` están duplicadas** (ver arriba). Es el riesgo de
   conflicto más concreto y hay que resolverlo **antes** de que cualquiera de los dos pushee.
2. **`athos_actions` sin implementar** de nuestro lado, y sin ruta de aprobación del lado del front.
3. **Doble canal de WhatsApp** (clínico vs cobranza) sin árbitro definido.
4. **El front está una feature atrás** en la abstención (punto anterior).
5. **Concurrencia**: el principal está en compute Micro; con 4 consultas simultáneas la base llegó a
   cerrar conexiones durante las mediciones.

## Verificación de que Athos sigue sano contra este esquema

- `/health` responde 200; `/athos/chat` sin JWT responde 401.
- 129 tests pasan; `ruff` limpio en `app/` y `tests/`.
- Último mensaje de chat registrado: 2026-07-28 13:23 UTC.
- Banco completo de retrieval contra producción: **hit@15 83,6%**, precision@15 30,5%, primer
  acierto en el puesto 2 (mediana), 146/146 casos sin fallos.

---

# Segunda pasada — auditoría de la integración (2026-07-29)

Con el push del equipo ya en `master` se re-auditó TODO (base de producción + los 21 commits).

## Verificado

- **El historial del principal termina en `0032` (su numeración vieja)**, 03:18 UTC del 29-jul.
  Nada nuevo entró después. `scripts/calidad/auditar_esquema.py` corre limpio: la única tabla que
  el repo no declara es `memberships` (nació out-of-band; `0022` la documenta y la arregla).
- **Las 11 migraciones renumeradas (`0026`–`0036`) coinciden sentencia por sentencia con el SQL
  aplicado en producción** (comparadas contra `schema_migrations.statements`, 332 sentencias DDL
  clave): la renumeración fue solo de nombre de archivo. No reaplicar.
- **Permisos del RAG intactos** tras el hardening: CRUD completo sobre las 7 tablas que escribimos.
- Facturación/cartera **no toca datos de Athos**: solo `owners.id_doc_type` (aditiva, nullable) y
  FKs `on delete set null` hacia `profiles`/`patients`/`consultations`. Ningún trigger nuevo sobre
  tablas nuestras. El barrido de cartera hoy es un no-op (0 clínicas con `reminders_enabled`).

## Lo que ajustamos de nuestro lado (2026-07-29)

`POST /athos/retrieve` (la tool `search_clinical_evidence` del agente) tenía tres huecos de
integración, ya corregidos:

1. **El agente no podía abstenerse.** Su prompt cuelga el "no hay evidencia suficiente" de
   `passed`, que está saturado (True en 187/187 medidos). El endpoint ahora corre el **juez de
   evidencia** y devuelve `evidence_level: none|limited|sufficient` — la señal que sí discrimina.
   → **Pipe: el system-prompt del agente debe usar la banda, no `passed`.**
2. **Latencia vs el timeout de 20s del front**: el endpoint usaba el camino serial; ahora usa
   `build_and_retrieve` (Tier 2 solapado con el A→B, varios segundos menos). El juez suma ~1,8s
   y falla abierta.
3. **Trazabilidad**: se logueaba solo con `patient_id`, y la bandeja y la consulta general mandan
   `patient_id: null` — la mayoría del tráfico del agente no quedaba en `rag_retrieval_log`.
   Ahora se traza siempre con `source='agent'`.
4. **Especie como texto libre**: la tool acepta "Canino"/"hurón"/"Felino" y el mapeo a MeSH solo
   conocía "perro"/"gato"/…, perdiendo la preferencia en silencio. Ahora se normaliza (acentos,
   mayúsculas) con sinónimos canino/felino/pájaro.

## Hallazgos para el equipo (de la tanda integrada, ordenados por urgencia)

1. 🔴 **`CRON_SECRET` sin configurar en Vercel** (pendiente manual en `ESTADO.md`): con el
   endurecimiento nuevo, `/api/cron/purge-audio` devuelve **503** y la retención de audio a 4 días
   (Ley 1581) **deja de correr en silencio**. Configurarla HOY.
2. 🔴 **El prompt del agente decide honestidad con `passed`** (`system-prompt.ts:39`) — ver arriba;
   el campo `evidence_level` ya viaja en la respuesta.
3. 🟠 **`payload_override` sin revalidar**: al aprobar, `execute` mergea el override sobre el
   payload sin validarlo contra el schema Zod de la tool (el schema solo corre al proponer).
   Cualquier miembro puede reescribir `to_phone`/`patient_id`/`starts_at` por API.
4. 🟠 **`0026` borra `clinic_logos_storage_select`** que `0024` creó a propósito (el
   `INSERT … RETURNING` de Storage falla sin SELECT — "trampa ya pisada dos veces" según
   `MULTITENANT.md`). Probable regresión al subir el logo. Mejor una policy restringida que el drop.
5. 🟠 **Cartera y asistente clínico comparten cuota y contexto**: los envíos de cobranza cuentan
   contra `auto_daily_limit` del modo auto clínico; un titular con factura activa que escribe algo
   clínico ("mi perro vomita hace 3 días") lo clasifica el catálogo de cobranza, no el clasificador
   clínico; `media_url` nunca se persiste (el flujo de comprobantes es código muerto); y la ruta
   del link de pago `/f/[token]` no existe (todo recordatorio saldría con un 404).
6. 🟡 **Propuestas del agente**: el badge y la bandeja no filtran `expires_at` (las vencidas se
   muestran como aprobables); las propuestas hechas en el chat se pierden de la UI al recargar.
7. 🟡 **`POST /athos/whatsapp/suggest` quedó sin llamadores** (la bandeja migró al agente de Next):
   sigue montado y funcional. Decidir con Pipe si se depreca — y borrar `athosWhatsappSuggest` de
   `src/lib/athos.ts`, que ya es código muerto. Guardrails de "nada clínico" hoy triplicados.
8. 🟡 **186 tests de facturación/cartera sin CI** (no hay workflow en la raíz del monorepo — el
   mismo problema que ya tenía nuestro `athos-service/.github/workflows/ci.yml`).
9. Menores: `META_REGISTER_PIN` defaultea a `"000000"`; el fallback `?secret=` del webhook de
   Kapso sigue vivo; `xlsx` vulnerable corre server-side en el import de facturación; los
   pendientes 10/12/13 de `ESTADO.md` ya están resueltos en `master` (lista desfasada).

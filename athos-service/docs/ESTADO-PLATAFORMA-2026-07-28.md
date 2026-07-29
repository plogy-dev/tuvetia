# Auditoría de la plataforma — 2026-07-28

> Foto completa del sistema tal como está HOY en producción, hecha antes de pushear nada, para que
> el trabajo de Athos no choque con los cambios grandes que entraron por otro lado.
> Todo lo de acá se verificó **contra la base de producción** (`auxlnexhkmtoedrzfsnz`, us-west-2),
> sólo lectura, salvo lo que se indique.

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

1. **Numeración de migraciones.** El principal lleva su propio historial con versiones tipo
   `20260727073858`; las nuestras (`0001`–`0025`) se aplican a mano y no quedan registradas ahí. Si
   otro aplica SQL en paralelo, nadie tiene un registro común. Acordar dónde vive el SQL de la capa
   nueva antes de que crezca más.
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

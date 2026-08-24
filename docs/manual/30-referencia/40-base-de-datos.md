---
titulo: Base de datos
seccion: referencia
orden: 40
resumen: Las ~66 tablas por dominio, los enums, las funciones del esquema private y cómo se aplican las migraciones.
---

# Base de datos

Postgres sobre Supabase. El esquema vive en `athos-service/supabase/`:

| Ruta | Qué es |
|---|---|
| `bootstrap/000_base_schema.sql` | El esquema base: tablas, enums, RLS y funciones de `private` |
| `migrations/0006…0080` | Las migraciones, en orden numérico |
| `verificaciones/` | Un `.sql` por migración que comprueba que quedó aplicada |

## Los dos esquemas

| Esquema | Para qué |
|---|---|
| `public` | Las tablas del producto. Expuestas por PostgREST, con RLS |
| `private` | Las funciones auxiliares. **No se exponen**: son lo que la RLS usa para decidir |

## Las funciones de `private`

Son el corazón del aislamiento y de las reglas que no se pueden expresar con un `CHECK`.

| Función | Qué hace |
|---|---|
| `my_clinic_id()` | La clínica del usuario actual. **Es la que aparece en casi todas las policies** |
| `my_role()` | El rol del usuario actual (`admin` \| `vet`) |
| `provision_new_clinic()` | Crea la clínica al registrarse alguien |
| `ensure_clinic_membership()` | Garantiza la pertenencia |
| `registrar_cambio()` | Escribe en `audit_logs` |
| `impedir_solape_de_citas()` | Bloquea que un vet quede con dos citas encima |
| `horario_es_del_mismo_equipo()` | Un horario personal tiene que ser de alguien de la misma clínica |
| `enforce_consent_before_audio()` | No se graba audio sin consentimiento registrado |
| `informe_solo_de_nota_aprobada()` | No se manda informe de una nota en borrador |
| `la_nota_credito_cabe_en_la_factura()` | Una factura no se acredita de más |
| `arrancar_la_prueba()` | Inicia la prueba gratuita |

Varias de estas son **triggers y no chequeos en las funciones RPC**, y eso es deliberado: los RPC no
son el único camino de escritura. El calendario, por ejemplo, actualiza horarios con un `update`
directo al arrastrar una cita, y una guarda que viviera sólo en `update_appointment` dejaría abierta
justo la vía por la que más fácil se produce un solape.

## Enums

| Enum | Valores |
|---|---|
| `user_role` | `admin`, `vet` |
| `patient_sex` | `male`, `female`, `unknown` |
| `allergy_severity` | `mild`, `moderate`, `severe` |
| `note_status` | `draft`, `approved`, `locked` |
| `whatsapp_agent_mode` | `auto`, `review`, `paused`, `intervene` |
| `appointment_status` | `scheduled`, `confirmed`, `in_progress`, `completed`, `canceled`, `no_show` |

## Las tablas, por dominio

### Núcleo e identidad

| Tabla | Qué guarda |
|---|---|
| `clinics` | El inquilino. Nombre, `slug`, contacto, **dirección**, logo, plan, estado de suscripción, `owner_id` |
| `profiles` | Las personas del equipo. Espeja `auth.users`. Tiene `clinic_id`, `role`, `is_active`, `ve_agenda_completa` |
| `memberships` | Multi-clínica. **Es la fuente de verdad de a qué clínicas pertenece alguien**; `profiles.clinic_id` es sólo la *activa* |
| `invitations` | Invitaciones pendientes, con token y vencimiento |
| `audit_logs` | Rastro de cambios |

### Clínico

| Tabla | Qué guarda |
|---|---|
| `owners` | Los titulares (clientes). **No tienen cuenta** |
| `patients` | Los animales |
| `consultations` | Las consultas |
| `clinical_notes` | Las notas, con `note_status` |
| `transcripts` | Transcripciones del Modo Fantasma |
| `consultation_audios` | El audio. **Se purga a los 4 días** por el cron |
| `consents` | Consentimiento de grabación |
| `allergies`, `medications`, `vaccines` | Historia |
| `patient_attachments` | Adjuntos |
| `patient_embeddings` | Memoria por paciente para el RAG |
| `client_reports` | Informes al titular |

### Agenda

| Tabla | Qué guarda |
|---|---|
| `appointments` | Las citas. `vet_id` decide de quién son |
| `clinic_hours` | Horarios. `vet_id` nulo = de la clínica; con valor = personal |
| `calendar_feeds` | Los tokens de los feeds ICS |
| `calendar_integrations` | **Legado**: sólo la usa Outlook y está en vías de desaparecer |

### Comunicación

| Tabla | Qué guarda |
|---|---|
| `whatsapp_integrations` | La conexión de cada clínica, con el token **cifrado** |
| `whatsapp_messages` | El hilo |
| `email_threads`, `email_messages` | La bandeja de correo |
| `email_integrations` | Legado de la cuenta SMTP institucional, retirada |
| `comm_messages` | Mensajes de cobranza |
| `channel_authorizations` | Autorizaciones de canal |
| `owner_email_optout` | Bajas de correo |
| `human_tasks` | Lo que el agente escala a una persona |

### Facturación e inventario

| Tabla | Qué guarda |
|---|---|
| `invoices`, `invoice_lines`, `invoice_events` | Facturas |
| `credit_notes` | Notas crédito, con la guarda de que no excedan la factura |
| `numbering_ranges` | Rangos de numeración fiscal |
| `fiscal_documents` | Documentos fiscales |
| `payments`, `payment_applications` | Pagos y su aplicación |
| `billing_settings`, `billing_payers` | Configuración y pagadores |
| `catalog_items`, `catalog_categories`, `catalog_lots` | Catálogo e inventario por lote |
| `inventory_movements` | Movimientos de existencias |
| `purchases`, `purchase_items`, `suppliers` | Compras |
| `expenses` | Gastos |
| `receipt_attachments` | Soportes |
| `service_consumptions` | Consumos de servicio |
| `invoice_reminders`, `invoice_email_threads` | Cobranza |
| `import_batches` | Importaciones |

### Athos y RAG

| Tabla | Qué guarda |
|---|---|
| `athos_actions` | Las acciones **propuestas** por el agente, pendientes de aprobación |
| `athos_messages` | El hilo del chat |
| `athos_agent_usage` | Consumo, para el tope mensual |
| `corpus_chunks` | El corpus de literatura troceado |
| `glossary_term`, `glossary_synonym`, `glossary_relation` | El glosario |
| `rag_retrieval_log`, `rag_answer_log` | Qué recuperó y qué respondió |

### Plataforma

| Tabla | Qué guarda |
|---|---|
| `suscripcion_cobros`, `suscripcion_eventos` | Cobros de la suscripción |
| `clinic_briefings` | El resumen diario |
| `tablero_preferencias` | El tablero **de cada persona** |
| `tablero_default_clinica` | El tablero con el que **entra** la clínica, que define el admin |

## Cómo se escribe una migración acá

Las de este repositorio siguen convenciones que valen la pena copiar:

1. **Numeración correlativa**, con el número siguiente al último. Hay un test
   (`numeracion-de-migraciones`) que vigila el archivo.
2. **Idempotentes**: `if not exists`, `create or replace`, `drop trigger if exists` antes de crear.
3. **Se buscan las restricciones por forma, no por nombre.** Un `drop constraint if exists` con el
   nombre equivocado **no falla: no hace nada**, y la restricción vieja sigue en pie sin que nadie se
   entere. Ver `0069_horario_por_persona.sql`, que las busca por las columnas que cubren.
4. **`alter policy` en vez de `drop` + `create`.** Son dos sentencias, y `psql -f` sin `-1` las corre
   en autocommit: entre una y otra queda una ventana, corta pero real, **con RLS habilitada y sin
   policy**.
5. **Las funciones `security definer` fijan `search_path`.** Sin eso se las puede secuestrar creando
   un objeto homónimo en un esquema que el llamador controle.
6. **La cabecera explica el porqué**, con el pedido que la originó y qué se descartó.

## Cosas que sorprenden

- **Hay números de migración duplicados** (`0019`, `0020`, `0065`): dos archivos con el mismo
  prefijo. Vienen de antes y conviven.
- **`profiles.clinic_id` no es la fuente de verdad multi-clínica**: es la clínica *activa*.
  `memberships` es la lista completa.
- **`ve_agenda_completa` no se puede escribir desde el cliente.** Un trigger lo bloquea: la policy de
  `profiles` deja que cada uno edite su propio perfil, así que sin esa guarda cualquiera se otorgaría
  el permiso desde la consola del navegador. Se cambia sólo por RPC.

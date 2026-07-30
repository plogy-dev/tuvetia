# Inventario de componentes — TUVET IA

**Contrato:** COT-2026-TUV-001 · **Documento exigido por:** Otrosí N.° 1, numeral 2.1
**Fecha de corte:** 30 de julio de 2026 · **Versión:** 1.0
**Repositorio:** `plogy-dev/tuvetia`, rama `master` · **Commit de corte:** `31db27a`

---

## Propósito y cómo leerlo

Este documento enumera **cada componente construido**, dónde vive en el código, en qué estado está y
con qué evidencia se puede verificar. Es el inventario formal que pide el Otrosí; el detalle técnico
ítem por ítem está en `athos-service/docs/AUDITORIA-MILESTONE2-2026-07-29.md`.

**Criterio de estado**, aplicando la regla de verificación del Otrosí (numeral 2.3) — *sólo cuenta lo
integrado y operando en el entorno accesible al cliente*:

| Estado | Significado |
|---|---|
| ✅ **Operando** | Integrado, alcanzable por el usuario y verificado en el entorno desplegado |
| ⚠️ **Parcial** | Funciona con una limitación declarada, o le falta una pieza para ser completo |
| 🔧 **Sin interfaz** | El motor existe y está probado, pero el usuario no puede alcanzarlo |
| ⏳ **Bloqueado** | Construido o construible, detenido por un insumo externo (cuenta, trámite, credencial) |
| ❌ **No construido** | No existe |

**Cómo verificar cualquier fila:** las rutas de `/dashboard/*` se abren en la aplicación; las de
`/api/*` y los endpoints del backend responden a una petición; lo demás se verifica con el archivo
citado o con una consulta a la base de datos.

**Entornos:** front en **Vercel** (Next.js, raíz del repositorio) · backend Athos en **Railway**
(`athos-service/`, FastAPI, `https://athos-service-production.up.railway.app`) · datos en **Supabase**
(proyecto `auxlnexhkmtoedrzfsnz`, Postgres + pgvector).

---

## 1. Athos — asistente clínico con literatura citada

El núcleo del producto: responde consultas clínicas citando literatura veterinaria verificable.

| Componente | Qué hace | Dónde vive | Estado |
|---|---|---|---|
| **Corpus veterinario indexado** | 519.999 fragmentos con vector semántico e índice de texto completo, más 5 índices (HNSW + 3 GIN + PK). Corresponde a los 61.544 documentos entregados por el cliente | tabla `corpus_chunks` | ✅ Operando |
| **Glosario médico ES→EN** | 2.506 términos y 7.378 sinónimos; es el puente entre el lenguaje del dueño y la literatura en inglés | `glossary_term`, `glossary_synonym` | ✅ Operando |
| **Cascada de recuperación** | Filtros → léxico/MeSH → vectorial → fusión. Determinística, sin costo de tokens | `athos-service/app/retrieval/cascade.py` | ✅ Operando |
| **Reranking** | Cross-encoder de Cohere sobre los 40 candidatos; sube el acierto en el top-15 del 37,8 % al 69,7 % | `app/retrieval/rerank.py` | ✅ Operando |
| **Chat clínico (SSE)** | Responde en streaming citando fuentes | `POST /athos/chat` · UI en `/dashboard/consultas/[id]` | ✅ Operando |
| **Modo Fantasma** | Al cerrar la consulta genera la nota SOAP en borrador para que el veterinario la apruebe | `POST /athos/phantom/suggest` | ✅ Operando |
| **Transcripción de consultas** | Deepgram `nova-2`, español, con diarización | `POST /athos/transcribe` · `app/transcription.py` | ⚠️ Parcial — es **por lotes**, no en vivo |
| **Roles del diálogo** | Identifica quién es el veterinario y quién el titular, por marcadores del contenido | `app/speaker_roles.py` | ✅ Operando *(corregido el 29-jul; antes se suponía por quién hablaba primero)* |
| **Memoria del paciente** | Recupera la historia clínica previa por similitud semántica | `app/patient_memory.py`, `patient_embeddings` | ✅ Operando |
| **Historial de conversación** | El veterinario ve los turnos previos al volver al asistente | `src/lib/athos-history.ts` | ✅ Operando *(la pantalla se agregó el 29-jul; los datos existían desde el inicio)* |
| **Recuperación para el agente** | Da literatura al agente del front sin gastar el modelo de redacción | `POST /athos/retrieve` | ✅ Operando |

### 1.1 Garantías clínicas — impuestas por código, no por el prompt

Son las reglas que no pueden depender de la buena voluntad del modelo. Cada una tiene pruebas
automatizadas.

| Garantía | Qué impide | Dónde vive | Estado |
|---|---|---|---|
| **Gate de alergia severa** | Que se proponga un plan sin advertir una alergia severa registrada | `app/generation/allergy_gate.py` | ✅ Operando |
| **Gate de dosis** | Que llegue una cifra de dosis sin especie, peso y edad confirmados. **Medido: 0 de 24 respuestas** | `app/generation/dose_guard.py` | ✅ Operando |
| **Procedencia de citas** | Que el modelo invente una fuente: si el `[n]` no está en lo recuperado, se descarta | `app/generation/citations.py` | ✅ Operando |
| **Fidelidad de citas** | Que se cite un pasaje que no sostiene lo afirmado. Descarta el 18 % de referencias | `app/generation/citation_fidelity.py` | ⚠️ Parcial — reduce el problema, no lo elimina |
| **Juez de evidencia** | Que responda con seguridad sin literatura que lo respalde. Bandas: se abstiene / declara evidencia limitada / responde | `app/generation/evidence_judge.py` | ⚠️ Parcial — acierta en 61 % de los casos sin cobertura |
| **Aprobación humana** | Que una nota entre a la historia clínica sin que el veterinario la apruebe | `clinical_notes.status: draft → approved` | ✅ Operando |

### 1.2 Banco de calidad (LLM Harness)

Herramientas de evaluación y control de calidad. **27 scripts** en `athos-service/scripts/calidad/`,
documentados en su propio `README.md`.

| Componente | Qué mide | Estado |
|---|---|---|
| Golden set de humo | 11 casos, prueba de no-regresión. **Última corrida: 11/11** | ✅ Operando |
| Banco de recuperación | 146 casos anclados al corpus (`hit@15` 83,6 %) | ✅ Operando |
| Banco de negativos **validado** | 18 casos verificados como sin cobertura real | ✅ Operando |
| Banco de calidad de **respuestas** | Rúbrica de 5 dimensiones juzgada por un modelo distinto del redactor | ✅ Operando |
| Comparación A/B de prompts | Pareada, sobre la misma literatura recuperada | ✅ Operando |
| Medición de latencia | End-to-end y de servidor | ✅ Operando |
| Diagnóstico de recuperación | Localiza en qué paso de la cascada se pierde un caso | ✅ Operando |
| Pruebas automatizadas del backend | **173 pruebas** + linter, verdes | ✅ Operando |
| Integración continua | Ejecuta backend y front en cada push y PR | ⚠️ Parcial — el job del front se valida en su primera corrida |

---

## 2. Historia clínica y gestión de pacientes

| Componente | Ruta | Estado |
|---|---|---|
| Listado y búsqueda de pacientes | `/dashboard/patients` | ✅ Operando |
| Ficha e historia clínica del paciente | `/dashboard/patients/[id]` | ⚠️ Parcial — deuda de UX reconocida: la distribución maestro-detalle se considera confusa |
| Importación masiva de pacientes | `/dashboard/patients/import` | ✅ Operando |
| Titulares (dueños) | `/dashboard/owners` | ✅ Operando |
| Consultas: listado y detalle | `/dashboard/consultas`, `/dashboard/consultas/[id]` | ✅ Operando |
| Grabación con consentimiento (Ley 1581) | `src/components/consultation-recorder.tsx`, `consents` | ✅ Operando |
| Audio reproducible y purga a 4 días | `consultation-audios` + `/api/cron/purge-audio` | ⏳ **Bloqueado** — sin `CRON_SECRET` en Vercel la purga devuelve 503 y **la retención no corre** |
| Alergias, medicación y vacunas | dentro de la ficha | ✅ Operando |
| Exportación de datos | `/api/export` | ✅ Operando |
| Panel de inicio con métricas | `/dashboard` | ✅ Operando |
| Onboarding y datos de ejemplo | `/api/onboarding/demo-data` | ✅ Operando |
| Ayuda en la aplicación | `/dashboard/ayuda` | ⚠️ Parcial — guía breve, no manual de usuario |

---

## 3. Agenda y calendario

| Componente | Ruta | Estado |
|---|---|---|
| Calendario interno (mes/semana/día, arrastrar y soltar) | `/dashboard/calendario` | ✅ Operando |
| Citas con aislamiento por clínica | `appointments` + RPC | ✅ Operando |
| Horarios de atención configurables | `clinic_hours` | ✅ Operando |
| Google Calendar — envío (plataforma → Google) | `/api/google/calendar/push` | ⚠️ Parcial — **las citas creadas por Athos no se envían** |
| Google Calendar — traída (Google → plataforma) | `/api/google/calendar/sync` | ⚠️ Parcial — **sólo manual**: no hay suscripción de cambios ni tarea programada |
| Feed ICS de sólo lectura | `/api/calendar/ics/[token]` | ✅ Operando |
| Autorización de Google por veterinario | `/api/google/calendar/connect` | ⏳ Bloqueado — requiere verificación de Google para abrirlo al público |

---

## 4. Capa agéntica — Athos propone, el veterinario aprueba

**17 herramientas**: 10 de consulta y 7 que **proponen** escrituras. Ninguna escribe por su cuenta.

| Componente | Dónde vive | Estado |
|---|---|---|
| Chat agéntico | `/dashboard/asistente` → `/api/athos/agent` | ✅ Operando |
| 10 herramientas de consulta | `src/lib/athos-agent/tools.ts` | ✅ Operando |
| 7 herramientas de escritura mediada | ídem | ⏳ **Bloqueado** — sin `SUPABASE_SERVICE_ROLE_KEY` en Vercel fallan en caliente |
| Ciclo de aprobación | `/api/athos/actions/[id]/execute` y `/reject` | ⏳ Bloqueado — misma causa |
| Tarjeta de aprobación con edición | `src/components/athos/action-approval-card.tsx` | ✅ Operando |
| Protección contra doble ejecución | compare-and-set en `athos_actions` | ✅ Operando |
| Auditoría de acciones | `audit_logs` | ✅ Operando |
| Límite de uso por veterinario | `src/lib/athos-agent/rate-limit.ts` | ⚠️ Parcial — en memoria del proceso, no compartido entre instancias |
| Pruebas de la capa agéntica | `src/lib/athos-agent/__tests__/` | ⚠️ Parcial — invariantes de seguridad cubiertos; falta el ciclo HTTP |

---

## 5. Comunicaciones

| Componente | Dónde vive | Estado |
|---|---|---|
| Bandeja de WhatsApp | `/dashboard/comunicaciones` | ✅ Operando |
| Envío y recepción | `/api/whatsapp/send`, `/webhook` | ✅ Operando |
| Sugerencia de respuesta con Athos | `/api/athos/suggest-reply` | ✅ Operando |
| Modo automático con salvaguardas | `src/lib/whatsapp/auto-reply.ts` | ✅ Operando |
| Conexión vía Evolution (QR embebido) | `/api/whatsapp/evolution/connect` | ⚠️ Parcial — **protocolo no oficial**, con riesgo de bloqueo del número |
| Conexión oficial de Meta (embebida) | `/api/whatsapp/exchange` | ⏳ **Bloqueado** — trámite de App Review de Meta, 2 a 6 semanas |
| Conexión vía Kapso | `/api/whatsapp/connect` | ⚠️ Parcial — **redirige fuera de la plataforma** |
| Invitaciones de equipo | `/api/team/invite-email`, `/invitar/[token]` | ⚠️ Parcial — código corregido el 29-jul; falta ajustar la plantilla de correo en Supabase |
| **Correo electrónico / Gmail** | `src/lib/facturacion/email.ts` | ❌ **No construido** — es un stub declarado que siempre devuelve `email_no_configurado` |

---

## 6. Facturación, cartera e inventario

**25 tablas y 69 archivos de dominio con 186 pruebas. Cero interfaz.** El esquema está aplicado en
producción; el usuario no puede alcanzar el módulo desde la aplicación.

| Componente | Dónde vive | Estado |
|---|---|---|
| Núcleo fiscal (facturas, notas crédito, numeración DIAN) | `src/lib/facturacion/` | 🔧 Sin interfaz |
| Motor de cartera con límites de la Ley 2300 | `src/lib/cartera/` | 🔧 Sin interfaz |
| Catálogo e inventario por lotes | `src/lib/facturacion/` | 🔧 Sin interfaz |
| Compras, proveedores y gastos | ídem | 🔧 Sin interfaz |
| Importación desde Excel/CSV | `src/lib/facturacion/import/` | ⏳ Bloqueado — la librería `xlsx` tiene vulnerabilidades **sin corrección publicada** |
| Proveedor de facturación electrónica | `src/lib/facturacion/fiscal/sandbox.ts` | ⏳ Bloqueado — **es un entorno de pruebas**; sin habilitación DIAN no hay validez fiscal |
| Tarea programada de cobranza | `/api/cron/cartera` | ⏳ Bloqueado — sin `CRON_SECRET` |

---

## 7. Cuentas, acceso y multi-clínica

| Componente | Dónde vive | Estado |
|---|---|---|
| Ingreso con enlace mágico y Google | `/login`, `/auth/callback`, `/auth/confirm` | ⚠️ Parcial — la plantilla de correo de Supabase requiere ajuste |
| Cierre de sesión | `/auth/signout` | ✅ Operando *(agregado el 29-jul)* |
| Aislamiento por clínica | políticas RLS + `private.my_clinic_id()` | ✅ Operando |
| Aprovisionamiento de clínica | disparador de base de datos sobre `auth.users` | ✅ Operando |
| Membresías multi-clínica | `memberships` | ⚠️ Parcial — declarado, **no cableado**: un usuario sigue teniendo una clínica activa |
| Configuración de la clínica | `/dashboard/settings` | ✅ Operando |
| Landing pública | `/`, `/producto`, `/seguridad`, `/demo` | ✅ Operando |

---

## 8. Integración de motores de IA

| Proveedor | Rol | Estado |
|---|---|---|
| **DeepSeek** | Redacción, distilación, juez de evidencia y auditoría de citas — todo el backend | ✅ Operando |
| **Claude (Anthropic)** | Agente con herramientas, WhatsApp y lectura de documentos — en el front | ⚠️ Parcial — **no opera en el backend**: falta la credencial en Railway |
| **Gemini** | — | ❌ **No construido** |
| Cohere | Vectores semánticos y reranking | ✅ Operando |
| Deepgram | Transcripción de voz | ✅ Operando |

**Arquitectura:** el modelo **nunca está fijo en el código**; se elige por variable de entorno desde el
primer commit del proyecto (13 de julio de 2026), donde el archivo ya se llamaba *"Cliente LLM
agnóstico"*. Cambiar de proveedor es cambiar una variable, no reescribir el flujo — se demostró
migrando de Claude a DeepSeek en producción y revalidando el golden set completo.

| Capacidad exigida por el contrato | Estado |
|---|---|
| Prompts del sistema definidos | ✅ 14 en producción |
| Prompts versionados | ⚠️ Parcial — el historial es Git; no se guarda la versión junto a cada respuesta |
| Estructura de habilidades (*skills*) | ⚠️ Parcial — 17 herramientas con esquema; sin agrupación por dominio |
| **Cascada entre los tres modelos** | ❌ **No construida** — requiere las tres cuentas activas a la vez |
| **Enrutamiento dinámico por consulta** | ⚠️ Parcial — hoy es asignación fija por tipo de tarea |
| Pruebas comparativas entre modelos | ⚠️ Parcial — la herramienta existe desde el 22-jul; falta el informe |

---

## Resumen

**88 componentes inventariados.**

| Estado | Componentes | |
|---|---|---|
| ✅ **Operando** | **53** | 60 % |
| ⚠️ **Parcial** | 20 | 23 % |
| 🔧 **Sin interfaz** (motor listo, inalcanzable) | 4 | 5 % |
| ⏳ **Bloqueado por un insumo externo** | 8 | 9 % |
| ❌ **No construido** | 3 | 3 % |

Los 3 no construidos son: **Gemini**, la **cascada entre modelos** y el **correo electrónico**.

### Lo que se desbloquea con configuración (horas, sin desarrollo)

1. **`CRON_SECRET` en Vercel** → restablece la purga de audio y con ella la retención de 4 días de la
   Ley 1581, que **hoy no corre**. También habilita la cobranza automática.
2. **`SUPABASE_SERVICE_ROLE_KEY` en Vercel** → habilita las 7 acciones de escritura del agente y el
   ciclo de aprobación completo.
3. **Plantilla de correo en Supabase** → cierra el último defecto de las invitaciones.

### Lo que depende de terceros

| Insumo | Quién lo provee | Tiempo | Qué desbloquea |
|---|---|---|---|
| Cuenta de Google AI con crédito | Cliente | — | Gemini, y con él la cascada y las comparativas |
| Crédito de producción de Anthropic | Cliente | — | Claude operando también en el backend |
| App Review de Meta | Meta | 2–6 semanas | WhatsApp oficial embebido |
| Verificación de Google | Google | ~10 días | Calendario abierto al público |
| Habilitación DIAN | DIAN | semanas–meses | Facturación con validez fiscal |
| Corrección de `xlsx` | No publicada | — | Importación desde Excel |

### Lo que requiere decisión de alcance

- **Interfaz de facturación, cartera e inventario**: 5 a 7 semanas de desarrollo. El motor está
  completo y probado; falta toda la capa de presentación.
- **Correo electrónico**: 6 a 9 días más la verificación del dominio.
- **Definición de "estructura de habilidades"**: fijarla por escrito cambia la estimación entre un día
  y una reescritura.

---

*Documento preparado por el equipo técnico. El detalle de cada verificación, con archivo y línea, está
en `athos-service/docs/AUDITORIA-MILESTONE2-2026-07-29.md`.*

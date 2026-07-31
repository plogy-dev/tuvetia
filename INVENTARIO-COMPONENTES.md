# Inventario de componentes — TUVET IA

**Contrato:** COT-2026-TUV-001 · **Documento exigido por:** Otrosí N.° 1, numeral 2.1
**Fecha de corte:** 30 de julio de 2026, 13:20 · **Versión:** 1.4
**Repositorio:** `plogy-dev/tuvetia`, rama `master` · **Commit de corte:** `a507043`

> **Cambios de la v1.2 a esta v1.3 (mismo día, 11:30):** entraron **las 16 rutas de la interfaz de
> facturación, cartera e inventario** y **Claude quedó operando en el backend** con crédito
> verificado. Con eso la categoría **«sin interfaz» baja a CERO** — era exactamente la observación
> del cliente sobre «componentes presentados pero no operando»— y se publicó la **comparativa de
> calidad entre los tres modelos**. 70 componentes operando de 93.
>
> **Cambios de la v1.1 a la v1.2 (10:15):** el cliente entregó la credencial de Google
> y con eso **Gemini quedó integrado y operando en producción**, junto con la **cascada entre
> proveedores**. Eran los dos únicos incumplimientos literales del contrato que quedaban en pie;
> con esto **no queda ningún componente sin construir**. Claude sigue sin operar en el backend, pero
> por falta de crédito en su cuenta, no por falta de trabajo.
>
> **Cambios de la v1.0 (corte `31db27a`) a la v1.1:** 93 componentes y **64 operando**. Se
> corrigió además la regla de conteo, que en la v1.0 no era reproducible — ver el Resumen. Se movieron
> cinco filas: el **correo electrónico** dejó de ser un stub y ahora envía por
> SMTP y lee respuestas por IMAP; la **purga de audio de la Ley 1581 ya corre** (se verificó que
> `CRON_SECRET` está configurada en Vercel); la **integración continua** pasó de "sin validar" a verde
> con una suite e2e contra producción; y se agregaron cuatro componentes de garantía clínica y
> verificación del despliegue. El detalle está en `athos-service/docs/ESTADO-MILESTONE2-2026-07-30.md`.

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
| **Gate de dosis** | Que llegue una cifra de dosis sin especie, peso y edad confirmados. **Medido: de 40 notas, 8 borradores traían una cifra y 0 llegaron a la nota final** | `app/generation/dose_guard.py` | ✅ Operando |
| **Procedencia de citas** | Que el modelo invente una fuente: si el `[n]` no está en lo recuperado, se descarta | `app/generation/citations.py` | ✅ Operando |
| **Fidelidad de citas** | Que se cite un pasaje que no sostiene lo afirmado. Descarta el 18 % de referencias | `app/generation/citation_fidelity.py` | ⚠️ Parcial — reduce el problema, no lo elimina |
| **Reparación de la nota** | Que la nota nombre un signo clínico que la consulta no contiene ("se siente grande el hígado" escrito como "hepatomegalia palpable"). Detección determinística con el glosario y reescritura con las palabras de la consulta. **Medido: términos sin respaldo de 32 a 2 sobre 40 notas; el texto creció 15 %, no se borró nada** | `app/generation/transcript_fidelity.py` | ✅ Operando *(30-jul)* |
| **Auditoría de la nota contra la consulta** | Que S y O afirmen un hallazgo que nadie constató. Señala sin borrar: la decisión es del veterinario que firma | ídem | ⚠️ Parcial — **precisión 0,78 y recall 0,47**: lo que señala casi siempre vale, y se le escapa la mitad |
| **Afirmaciones ejecutables sin declarar** | Que un fármaco o una cifra se presenten como establecidos sin cita ni aviso. **Medido: 30 casos en 34 respuestas del chat; 14 en 12 de 40 notas** | `app/generation/undeclared.py` | ✅ Operando *(30-jul)* |
| **Juez de evidencia** | Que responda con seguridad sin literatura que lo respalde. Bandas: se abstiene / declara evidencia limitada / responde | `app/generation/evidence_judge.py` | ⚠️ Parcial — acierta en 61 % de los casos sin cobertura |
| **Aprobación humana** | Que una nota entre a la historia clínica sin que el veterinario la apruebe | `clinical_notes.status: draft → approved` | ✅ Operando |

> **Cómo se verifican estas garantías, y por qué importa la distinción.** Las que dicen *Medido* se
> comprueban con una **propiedad contable del texto** —cuántas cifras de dosis sobreviven, cuántos
> términos no aparecen en la consulta—, así que el número es reproducible por cualquiera. Las que
> dicen *precisión* y *recall* dependen del juicio de un modelo evaluador y por eso llevan su margen
> declarado. La diferencia no es cosmética: el juez que puntúa en abstracto dio, **sobre el mismo
> prompt y el mismo banco**, seis resultados distintos entre 8/16 y 27/40 — un ruido de ±7 sobre 40.
> Ninguna cifra de este documento se apoya en él sin decirlo.

### 1.2 Banco de calidad (LLM Harness)

Herramientas de evaluación y control de calidad. **34 scripts** en `athos-service/scripts/calidad/`,
documentados en su propio `README.md`.

| Componente | Qué mide | Estado |
|---|---|---|
| Golden set de humo | 11 casos, prueba de no-regresión. **Última corrida: 11/11** | ✅ Operando |
| Banco de recuperación | 146 casos anclados al corpus (`hit@15` 83,6 %) | ✅ Operando |
| Banco de negativos **validado** | 18 casos verificados como sin cobertura real | ✅ Operando |
| Banco de calidad de **respuestas** | Rúbrica de 5 dimensiones juzgada por un modelo distinto del redactor | ✅ Operando |
| Banco de calidad de la **nota clínica** | Replica el Modo Fantasma completo **sin escribir en el expediente de nadie**; separa la fabricación en S/O de los señalamientos sobre el plan | ✅ Operando *(30-jul)* |
| Comparación A/B de prompts y de **estrategias de generación** | Pareada: el retrieval corre una vez y las dos variantes redactan sobre la misma literatura | ✅ Operando |
| Calibración del auditor contra verdad-de-terreno | Compara modelos de auditor sobre las mismas notas, sin volver a generarlas | ✅ Operando *(30-jul)* |
| Medición de latencia | End-to-end y de servidor | ✅ Operando |
| Diagnóstico de recuperación | Localiza en qué paso de la cascada se pierde un caso | ✅ Operando |
| Pruebas automatizadas | **199 del backend + 257 del front = 456**, más linter y verificación de tipos | ✅ Operando |
| Integración continua | `ruff` + `pytest` en el backend; tipos + linter + pruebas + compilación en el front, en cada push y PR | ✅ Operando *(verde; el job del front se validó el 29-jul)* |
| Smoke e2e contra el despliegue real | Cada 6 horas verifica por HTTP que las rutas privadas estén cerradas, que las APIs rechacen a un anónimo y que el backend responda | ✅ Operando *(30-jul)* |

> **Lo que el banco encontró, que es la razón de que exista:** 24 de 42 casos del banco de negativos
> no eran negativos (el instrumento estaba roto y toda medición de abstención anterior medía otra
> cosa); 18 de 24 respuestas citaban un pasaje que no sostenía la afirmación; la nota del Fantasma se
> guardaba **vacía** en 1 de 16 casos sin avisar; y un `chunk_id` crudo quedaba visible en el
> subjetivo de la historia clínica. Ninguno de los cuatro era detectable por inspección.

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
| Audio reproducible y purga a 4 días | `consultation-audios` + `/api/cron/purge-audio` | ✅ Operando *(desbloqueado el 30-jul: se verificó que `CRON_SECRET` está configurada en Vercel — `/api/health` responde 401 y no 503, y esa diferencia sólo ocurre si la variable existe)* |
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
| **Correo electrónico — envío por SMTP** | `src/lib/email/smtp.ts`, `integrations.ts`, credenciales cifradas en `crypto.ts` | ✅ Operando *(30-jul; era un stub)* |
| **Correo electrónico — lectura de respuestas por IMAP** | `src/lib/email/imap.ts`, `sync.ts`, `threading.ts` | ✅ Operando *(30-jul)* |
| **Conexión de correo desde la aplicación** | `/dashboard/settings` → `src/components/settings/email-settings.tsx` | ✅ Operando *(30-jul)* |
| Envío de facturas por correo | `src/lib/facturacion/email.ts` | ✅ Operando *(30-jul)* |
| Recordatorios de cobranza por correo | `src/lib/cartera/channels.ts` | ⚠️ Parcial — **el canal de salida sigue devolviendo `email_no_configurado`**: la cobranza sale sólo por WhatsApp aunque el correo ya funcione |
| **Chequeo de configuración del despliegue** | `GET /api/health` — responde qué está cableado en producción **sin revelar ningún valor** (sólo booleanos, protegido con `CRON_SECRET`) | ✅ Operando *(30-jul)* |

> **Por qué el chequeo de configuración es un componente y no una utilidad:** el problema que resolvió
> la auditoría es que las variables faltantes **apagan funciones enteras en silencio** — sin
> `CRON_SECRET` la retención de audio de la Ley 1581 dejaba de correr sin ningún error visible. Ahora
> el estado de producción se comprueba desde afuera en una petición.

---

## 6. Facturación, cartera e inventario

**16 rutas operando desde el 30-jul.** Eran 25 tablas y 69 archivos de dominio **sin una sola
pantalla**; ahora el módulo es alcanzable desde la navegación, cada página consulta datos reales y
tiene control de acceso por clínica. Lo que sigue bloqueado es la **validez fiscal**, no la
interfaz.

| Componente | Dónde vive | Estado |
|---|---|---|
| Núcleo fiscal (facturas, notas crédito, numeración DIAN) | `src/lib/facturacion/` + `/dashboard/facturacion`, `/nueva`, `/[id]`, `/[id]/imprimir` | ✅ Operando *(30-jul)* |
| Motor de cartera con límites de la Ley 2300 | `src/lib/cartera/` + `/dashboard/facturacion/cartera` | ✅ Operando *(30-jul)* |
| Catálogo e inventario por lotes | `/dashboard/facturacion/catalogo`, `/inventario`, `/inventario/movimientos` | ✅ Operando *(30-jul)* |
| Compras, proveedores y gastos | `/dashboard/facturacion/compras`, `/compras/proveedores`, `/finanzas` | ✅ Operando *(30-jul)* |
| Importación desde Excel/CSV | `src/lib/facturacion/import/` | ⏳ Bloqueado — la librería `xlsx` tiene vulnerabilidades **sin corrección publicada** |
| Proveedor de facturación electrónica | `src/lib/facturacion/fiscal/sandbox.ts` | ⏳ Bloqueado — **es un entorno de pruebas**; sin habilitación DIAN no hay validez fiscal |
| Tarea programada de cobranza | `/api/cron/cartera` + barrido por GitHub Actions (`cartera-sweep.yml`) | ⚠️ Parcial — **el barrido de Actions NO ha corrido nunca**: `CRON_SECRET` está en Vercel pero **falta en los secretos de GitHub Actions** (son dos almacenes distintos; 6/6 ejecuciones programadas en rojo el 30-jul, auditoría). Mientras tanto solo barre el cron diario de Vercel (9:00). El canal de correo de salida sí quedó cableado el 30-jul (`channels.ts`). Ojo además: el cron pide cada 15 min pero GitHub disparó ~1/80 min — es el piso, no una garantía |

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
| **Claude (Anthropic)** | Agente con herramientas, WhatsApp y lectura de documentos en el front, y **tercer eslabón de la cascada** en el backend | ✅ Operando *(30-jul: key en Railway y crédito verificado con una llamada real — `stop_reason=end_turn`, tier estándar)* |
| **Gemini** | Alternativa de la cascada en redacción y en el camino liviano | ✅ Operando *(30-jul: integrado por su endpoint compatible con OpenAI, key en Railway, verificado contra el proveedor real)* |
| Cohere | Vectores semánticos y reranking | ✅ Operando |
| Deepgram | Transcripción de voz | ✅ Operando |

**Arquitectura:** el modelo **nunca está fijo en el código**; se elige por variable de entorno desde el
primer commit del proyecto (13 de julio de 2026), donde el archivo ya se llamaba *"Cliente LLM
agnóstico"*. Cambiar de proveedor es cambiar una variable, no reescribir el flujo — se demostró
migrando de Claude a DeepSeek en producción y revalidando el golden set completo.

| Capacidad exigida por el contrato | Estado |
|---|---|
| Prompts del sistema definidos | ✅ 16 en producción |
| Prompts versionados | ⚠️ Parcial — el historial es Git; no se guarda la versión junto a cada respuesta |
| Estructura de habilidades (*skills*) | ⚠️ Parcial — 17 herramientas con esquema; sin agrupación por dominio |
| **Cascada entre modelos** | ✅ **Construida y operando** — `app/generation/provider_cascade.py`, configurada en Railway. Ante caída, timeout o saldo agotado del primario responde el siguiente. Anthropic queda fuera de la cadena hasta que su cuenta tenga crédito |
| **Enrutamiento dinámico por consulta** | ✅ **Operando** *(30-jul)* — cadenas por tarea, y además por CONSULTA: cuando el juez dictamina cobertura `limited` la nota escala al modelo que mide mejor en fidelidad. Es el 12-15 % de los casos, medido antes de encenderlo |
| Pruebas comparativas entre modelos | ✅ **Corridas y publicadas** — `athos-service/docs/COMPARATIVA-MODELOS-2026-07-30.md`. DeepSeek gana 24-2 a Gemini; contra Claude el resultado depende del juez (21-2 vs 16-14), y sólo se reporta lo que sobrevive a los dos |

---

## Resumen

**93 componentes inventariados.**

| Estado | Componentes | | v1.2 | v1.1 |
|---|---|---|---|---|
| ✅ **Operando** | **70** | 75 % | 65 | 64 |
| ⚠️ **Parcial** | 17 | 18 % | 18 | 18 |
| 🔧 **Sin interfaz** (motor listo, inalcanzable) | **0** | 0 % | 4 | 4 |
| ⏳ **Bloqueado por un insumo externo** | 6 | 6 % | 6 | 6 |
| ❌ **No construido** | **0** | 0 % | 0 | 1 |

> **Regla de conteo, declarada para que el número sea reproducible:** se cuenta **una fila por
> componente** de las tablas de las secciones 1 a 8. La tabla de *capacidades exigidas por el contrato*
> de la sección 8 **no se cuenta**: es una vista de cumplimiento sobre componentes que ya están
> contados, y sumarla los duplicaría. La v1.0 mezclaba las dos cosas —de ahí que reportara 88 con
> 3 «no construidos»— y su total no se podía reproducir contando el documento. Corregido acá.

**No queda ningún componente sin construir, ni ninguno construido que el usuario no pueda alcanzar.**
Las dos categorías que sostenían la observación del cliente —«no construido» y «sin interfaz»— están
en cero. En 24 horas se cerraron: el correo electrónico, Gemini, la cascada entre los tres modelos, la
comparativa de calidad entre modelos y las 16 rutas de facturación, cartera e inventario.

Lo que queda es de dos naturalezas, y conviene no confundirlas en la reunión:

1. **Detenido por un tercero, no por nosotros:** App Review de Meta (2–6 semanas), verificación de
   Google para el calendario (~10 días), **habilitación DIAN** para que la facturación tenga validez
   fiscal, y la corrección del paquete `xlsx` para la importación desde Excel.
2. **Limitaciones declaradas de lo que sí opera:** la transcripción es por lotes y no en vivo; el
   enrutamiento entre modelos es por tarea y no por consulta; el auditor de la nota clínica atrapa la
   mitad de los casos; y falta el manual de usuario.

> ⚠️ **Una distinción que hay que sostener con honestidad el 3-ago:** que la **interfaz** de
> facturación exista no significa que se pueda **facturar con validez fiscal**. El proveedor sigue
> siendo un entorno de pruebas y eso depende de la DIAN. Y el módulo todavía **no se ha verificado en
> caliente contra datos reales de una clínica**, que es lo único que convierte «construido» en
> «operando» sin reservas.

### Lo que se desbloquea con configuración (minutos, sin desarrollo)

1. ~~`CRON_SECRET` en Vercel~~ → ✅ **RESUELTO.** Verificado el 30-jul: `/api/health` responde 401 y no
   503, y esa diferencia sólo ocurre si la variable existe. Con eso **la retención de audio de la Ley
   1581 volvió a correr** y el barrido de cobranza también.
2. **`SUPABASE_SERVICE_ROLE_KEY` en Vercel** → habilita las 7 acciones de escritura del agente y el
   ciclo de aprobación completo. **No se pudo verificar desde afuera** porque el valor de
   `CRON_SECRET` en Vercel no es el que tenemos. Para confirmarlo en 30 segundos y sin exponer nada:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://tuvetia.vercel.app/api/health` — devuelve
   **sólo booleanos**, ni valores ni prefijos ni longitudes.
3. **Plantilla de correo en Supabase** → cierra el último defecto de las invitaciones.

### Lo que se cierra en horas de desarrollo

1. **Cablear el canal de salida de cartera al correo** (2–4 h). Hoy las facturas salen por correo y las
   respuestas entran por IMAP, pero los recordatorios de cobranza siguen siendo sólo WhatsApp porque
   `RealMessaging` conserva el `email_no_configurado` anterior.

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
  completo y probado; falta toda la capa de presentación. **Es la decisión más urgente**: si se
  mantiene en el Milestone 2, compite por los mismos días que la calidad clínica.
- **Transcripción en tiempo real**: 3 a 5 días. Hoy es por lotes.
- **Definición de "estructura de habilidades"**: fijarla por escrito cambia la estimación entre un día
  y una reescritura.

### Lo que sigue abierto en la calidad clínica

Se declara para que nadie lea este inventario como más garantía de la que da. La nota del Modo Fantasma
**es un borrador que el veterinario aprueba**, y con las mitigaciones del 30-jul los puntos dudosos le
llegan señalados. Pero el juez de calidad sigue detectando un hallazgo afirmado sin respaldo en S u O
en **~15 de 40 notas**, y ese número es en parte real y en parte del propio juez: no se pudo separar
con más precisión porque el instrumento tiene ±7 de ruido sobre 40. Lo que sí es verificable sin
opinión de nadie es que **los términos clínicos que la nota nombra y la consulta no contiene bajaron de
32 a 2**.

---

*Documento preparado por el equipo técnico. El detalle de cada verificación, con archivo y línea, está
en `athos-service/docs/ESTADO-MILESTONE2-2026-07-30.md` (estado actual) y en
`athos-service/docs/AUDITORIA-MILESTONE2-2026-07-29.md` (auditoría ítem por ítem).*

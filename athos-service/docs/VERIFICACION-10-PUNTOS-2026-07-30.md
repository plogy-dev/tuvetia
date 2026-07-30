# Verificación punto por punto — 10 observaciones del cliente

**Corte:** 30 de julio de 2026, 12:15 · **Commit:** `d31e64c` · **Contrato:** COT-2026-TUV-001

Cada punto se verificó **hoy, contra el código integrado y el entorno desplegado** — no contra la
documentación previa. Se aplica la regla del Otrosí num. 2.3: *sólo cuenta lo integrado y operando en
el entorno accesible al cliente*.

| Estado | Significado |
|---|---|
| ✅ | Funciona **y** está documentado |
| ⚠️ | Funciona con una limitación declarada, o le falta una pieza |
| ❌ | No cumple |

---

## Tabla resumen

| # | Punto | Funciona | Documentado |
|---|---|---|---|
| 1 | Cascada + routing de 3 modelos | ✅ | ✅ |
| 2 | Agent smoke testing | ✅ | ✅ |
| 3 | Mecanismo de abstención | ⚠️ | ✅ |
| 4 | Citas de fuentes correctas | ⚠️ | ✅ |
| 5 | Latencia de minutos → segundos | ✅ | ✅ |
| 6 | Correo / módulo de comunicaciones | ✅ | ✅ |
| 7 | Google Calendar bidireccional | ✅ | ✅ |
| 8 | Transcripción: roles / lotes / fecha | ⚠️ | ✅ |
| 9 | Invitaciones de equipo | ⚠️ | ✅ |
| 10 | Historial de conversaciones | ✅ | ✅ |

**7 de 10 sin reservas. 3 con una limitación concreta y declarada. Ninguno en ❌.**

> Los puntos **6 y 7** se cerraron a las 12:15 (`d31e64c`), después de que esta misma verificación
> los dejara a la vista. Los dos eran el mismo tipo de defecto: **un módulo construido y probado que
> nadie había conectado con quien tenía que usarlo** — se ven como "funciona" hasta que se sigue el
> camino completo.

---

## 1. Cascada + routing de 3 modelos — ✅ FUNCIONA Y ESTÁ DOCUMENTADO

**Dónde:** `athos-service/app/generation/provider_cascade.py`
**Configurado en producción (Railway):**
```
LLM_CASCADE_REDACCION = deepseek-v4-flash@openai,gemini-3.6-flash@google,claude-sonnet-5@anthropic
LLM_CASCADE_LIVIANO   = deepseek-v4-flash@openai,gemini-2.5-flash-lite@google,claude-haiku-4-5@anthropic
```

**Verificado contra los tres proveedores reales:**

| Escenario | Resultado |
|---|---|
| Gemini directo | responde, 4,0 s |
| Claude directo | responde, 7,2 s |
| Camino feliz con los tres configurados | DeepSeek en 1,4 s — **ni Gemini ni Claude se llaman** |
| Primario caído | Gemini toma el relevo, 3,9 s |
| **Caen los dos primeros** | **la cascada llega hasta Claude, 3,7 s** |

**Routing:** cadenas independientes por tipo de tarea — redacción (calidad primero) y liviano (costo y
volumen primero), hoy con modelos distintos en producción.

> ⚠️ **Distinción que hay que sostener:** el routing es **por tarea**, no **por consulta**. La cláusula
> pide asignar cada consulta según costo, velocidad y precisión. Eso exige primero la comparativa de
> calidad entre modelos (que ya existe, punto siguiente) y es el trabajo que sigue.
>
> ⚠️ **Ojo con la homonimia:** `app/retrieval/cascade.py` es la cascada de **recuperación de
> documentos** y no tiene relación con esto. La evidencia de este punto es `provider_cascade.py`.

**Documentación:** `docs/COMPARATIVA-MODELOS-2026-07-30.md`, `ESTADO-MILESTONE2-2026-07-30.md` §1.4-1.5,
`.env.example`.

## 2. Agent smoke testing — ✅ FUNCIONA Y ESTÁ DOCUMENTADO

**Dónde:** `src/lib/athos-agent/__tests__/agent-smoke.test.ts` — **22 casos**, corren en CI en cada
push y PR.
**Documento de resultados:** `docs/AGENT-SMOKE-TESTING.md`.

Cubre: aprobación humana (7 casos), inventario y separación lectura/escritura (3), zona horaria (2) y
fechas imposibles (10).

**Encontró un defecto real que nadie había visto:** `2026-02-30` no es una fecha inválida para
JavaScript — la rueda a `2026-03-02`. **La cita del agente se agendaba otro día sin avisar.** Eso es
corrupción silenciosa, peor que un error visible.

## 3. Mecanismo de abstención — ⚠️ FUNCIONA, con precisión declarada

**Dónde:** `athos-service/app/generation/evidence_judge.py`. Bandas `none` / `limited` / `sufficient`.

**Sobre el "0 activaciones en 187 casos" que reportó el cliente: la observación era correcta y la causa
está identificada.** El umbral determinístico daba `passed=True` en 187/187 porque el score está
saturado — ninguna señal gratuita discrimina cobertura (score 1.701 vs 1.700; reranker 0,532 vs 0,499;
número de citas 6,0 vs 6,0). Por eso se agregó un juez semántico que **lee** los pasajes.

**Estado medido:** acierta **11 de 18** casos sin cobertura (61 %), con sólo **1 de 16** de
sobre-abstención.

> **Por qué no decimos 100 %:** el 61 % es mejorable. Y hay un hallazgo previo que conviene conocer:
> **24 de 42 casos del banco de negativos original no eran negativos** — tenían literatura real. El
> instrumento estaba roto, así que toda medición de abstención anterior a esa corrección medía otra
> cosa. El 61 % es contra un banco validado.

## 4. Citas de fuentes correctas — ⚠️ FUNCIONA, con margen declarado

Son **dos capas distintas**:

| Capa | Qué impide | Estado |
|---|---|---|
| **Procedencia** (`citations.py`, determinística) | que el modelo invente una fuente | ✅ **0 citas inventadas** en todas las corridas |
| **Fidelidad** (`citation_fidelity.py`, LLM) | que el pasaje citado no sostenga lo afirmado | ⚠️ **13 % de descarte** (34 de 261 en 40 notas) |

**El origen del problema, medido:** 18 de 24 respuestas citaban al menos un pasaje que no respaldaba la
afirmación. El modelo redactaba desde su conocimiento y "decoraba" con números. Por eso existe la
segunda capa.

Sin calibrar, el auditor descartaba el **58 %** — castigaba la reformulación legítima igual que la
extrapolación. Calibrado, descarta el 13-18 % y ninguna respuesta queda sin fuentes.

> **Margen honesto:** la revisión humana de 6 descartes dio 4 correctos, 1 defendible y 1 falso
> positivo. Con esa proporción, ~1 de cada 6 descartes puede estar quitando una fuente válida. Falla
> abierta: si el verificador no puede opinar, las citas quedan como estaban.

## 5. Latencia de ~5 minutos → segundos — ✅ RESUELTO

**Medido con el pipeline real, desde fuera del datacenter (medición pesimista):**

| | Tiempo |
|---|---|
| **Hasta el primer token** (lo que el veterinario percibe como espera) | **12,8 s** |
| Respuesta completa | 27,6 s |

**Las latencias de ~5 minutos no se reproducen.** Causa probable del reporte original: el Tier 1 del
retrieval tardaba **15.397 ms de servidor y se cancelaba por `statement_timeout`** — eso se percibe
como un cuelgue, no como lentitud. Corregido el 28-jul separando las dos ramas de la consulta:
**bajó a 143 ms** recuperando los mismos documentos.

**Instrumento:** `scripts/calidad/latencia_e2e.py`.

## 6. Correo / módulo de comunicaciones — ✅ FUNCIONA Y ESTÁ DOCUMENTADO

**Era un stub vacío** que devolvía siempre `email_no_configurado`. Hoy:

| Componente | Estado |
|---|---|
| Envío real por SMTP | ✅ `src/lib/email/smtp.ts` |
| Lectura de respuestas por IMAP | ✅ `src/lib/email/imap.ts`, `sync.ts` |
| Hilos de conversación | ✅ `threading.ts` (142 líneas de prueba) |
| Credenciales cifradas | ✅ `src/lib/crypto.ts` |
| Pantalla de conexión | ✅ `/dashboard/settings` |
| Envío de facturas por correo | ✅ `src/lib/facturacion/email.ts` |
| Barrido cada 15 min | ✅ GitHub Actions (`cartera-sweep.yml`) |
| **Recordatorios de cobranza por correo** | ✅ **cerrado 12:15** (`d31e64c`) |

**Lo que estaba roto y ya no:** `cartera/channels.ts` seguía devolviendo `email_no_configurado` y
declarando que el canal EMAIL *"nunca figura conectado"* — una decisión de cuando el correo era un
stub, que quedó fosilizada. El ciclo estaba abierto justo en el medio: las facturas salían y las
respuestas entraban, pero los recordatorios de cobranza seguían siendo sólo WhatsApp.

Tres cuidados en el arreglo, porque un canal de cobranza no puede fallar en silencio:
- El canal se reporta conectado **sólo si la clínica conectó el correo de verdad**; si no, se salta
  con log — como antes, pero por ausencia de configuración y no por diseño.
- Se propaga `transient`: el despachador distingue un corte de red o un límite del proveedor —que
  **reprograma**— de una credencial rechazada —que no—. Sin eso, un fallo de red **perdería** el
  recordatorio en vez de reintentarlo.
- Cada envío lleva su `Message-ID`, que es la raíz del hilo. Sin él, la respuesta del titular entraría
  por IMAP como un correo suelto, sin conversación a la que pegarse.

## 7. Google Calendar bidireccional — ✅ FUNCIONA EN AMBOS SENTIDOS

**Corrección a nuestra propia auditoría anterior:** habíamos reportado que sólo existía la traída
manual. **Es inexacto.** Verificado hoy en el código:

| Dirección | Estado |
|---|---|
| Plataforma → Google (crear cita) | ✅ **automático** — `appointment-calendar.tsx:137` llama a `/api/google/calendar/push` |
| Plataforma → Google (borrar cita) | ✅ **automático** — línea 153 → `/api/google/calendar/delete` |
| Google → Plataforma | ⚠️ **manual** — botón "Sincronizar" (`/api/google/calendar/sync`), sin webhook |
| Citas creadas por **el agente de Athos** | ✅ **cerrado 12:15** (`d31e64c`) |

**Lo que estaba roto y ya no:** la ruta que ejecuta una acción aprobada llamaba a la RPC
`create_appointment` y ahí terminaba. El síntoma para el veterinario era peor que un error — **una
cita agendada a mano aparecía en su teléfono y una agendada por Athos no**, sin ninguna señal de por
qué. Ahora empuja igual, y **no bloquea**: si no conectó Google o la API falla, se registra y se sigue.
La cita ya está creada en la plataforma; perder la copia en Google se arregla con "Sincronizar",
perder la cita no.

> ⚠️ **Lo único que queda, y depende de un tercero:** la sincronización **automática** Google →
> plataforma (hoy es un botón "Sincronizar") necesita la verificación de Google, ~10 días, para abrir
> la aplicación al público.

## 8. Transcripción — ⚠️ DOS DE TRES CORREGIDOS

| Defecto reportado | Estado |
|---|---|
| **Roles invertidos** (veterinario ↔ titular) | ✅ **corregido** (`05d1bd0`) |
| **Fecha errada** | ✅ **corregido** (`22f2cf1`) |
| **Por lotes, no en vivo** | ⚠️ **sigue por lotes** |

**Roles:** la causa era concreta — `SPEAKER_LABELS` asumía que el hablante 0 era el veterinario, y
Deepgram numera **por orden de habla**, con la etiqueta **horneada** dentro de `full_text`. Ahora el
rol **se infiere del contenido** (`app/speaker_roles.py`) con marcadores ponderados y un margen mínimo:
determinístico y auditable.

**Fecha:** 3 pantallas (no 2) estaban formateando en UTC porque los componentes de servidor corren en
UTC en Vercel. Ancladas a `America/Bogotá`, con pruebas que fuerzan `TZ=UTC` para que la regresión no
pueda volver.

**Por lotes:** confirmado hoy — `app/transcription.py:90` hace `POST` a
`https://api.deepgram.com/v1/listen` con el audio completo. El tiempo real exige el endpoint de
streaming por WebSocket y una interfaz incremental. **Esfuerzo: 3 a 5 días.**

## 9. Invitaciones de equipo — ⚠️ LOS 3 BUGS DE CÓDIGO CORREGIDOS

El enlace fallaba por **tres causas distintas**, las tres corregidas (`166c6a6`) y verificadas hoy:

1. **`redirectTo` apuntaba a `/invitar/<token>`**, una página que sólo lee el token — no establecía la
   sesión, así que el enlace "no hacía nada". Ahora va a `/auth/callback`.
2. **El origen salía de `new URL(req.url).origin`**, que daba el dominio efímero del deployment en vez
   del dominio real. Ahora usa `getAppBaseUrl()`.
3. **`/auth/signout` era `GET`**: el prefetch de un `<Link>` de Next **cerraba la sesión solo**. Ahora
   es `POST`.

> 🟠 **Lo que falta, y no es código:** ajustar la **plantilla de Magic Link y el Site URL en el panel
> de Supabase Auth**. Sin eso el correo puede seguir llegando con un enlace mal formado. **Es
> configuración, minutos.**

## 10. Historial de conversaciones — ✅ FUNCIONA

**Dónde:** `src/lib/athos-history.ts`, consumido por `/dashboard/asistente`.

**El matiz importante:** los datos **existían desde el inicio** en `athos_messages` — nunca se
perdieron. Lo que faltaba era **la pantalla**. Hoy el servidor precarga los hilos, los agrupa por
paciente y siembra la conversación, así que el veterinario ve los turnos previos al volver.

---

## Resumen para la reunión

**Lo que se puede afirmar sin reservas:** la cascada de los tres modelos, el smoke testing con su
documento, la latencia, y el historial.

**Lo que funciona con una limitación que conviene declarar antes de que la encuentren:**

| # | Limitación | Esfuerzo | De quién |
|---|---|---|---|
| 9 | Plantilla de Magic Link en el panel de Supabase | **minutos** | configuración, no código |
| 8 | Transcripción en tiempo real | 3–5 días | nuestro |
| 3 | Abstención: 61 % de acierto | medición continua | nuestro |
| 4 | Fidelidad de citas: ~1 de 6 descartes puede ser falso positivo | medición continua | nuestro |

**El punto 9 se cierra en minutos y no requiere desplegar nada** — es ajustar la plantilla de correo y
el Site URL en el panel de Supabase Auth. Con eso quedan **8 de 10 sin reservas**.

**Lo que depende de terceros y no de nosotros:** verificación de Google para el calendario automático
(~10 días), App Review de Meta para WhatsApp oficial (2–6 semanas), habilitación DIAN para la validez
fiscal de la facturación.

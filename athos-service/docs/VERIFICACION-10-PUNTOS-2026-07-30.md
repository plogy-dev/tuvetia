# Los 10 puntos priorizados — estado y qué falta exactamente para el 100 %

**Corte:** 2026-07-30, 17:00 · **Commit:** `ac641ab` · **Contrato:** COT-2026-TUV-001
**Regla:** Otrosí num. 2.3 — *sólo cuenta lo integrado y operando en el entorno accesible al cliente*.

Cada punto verificado hoy contra el código, las variables reales de Railway, la captura de las
variables de Vercel y la base de producción.

| # | Punto | Estado | Qué falta para el 100 % | De quién | Esfuerzo |
|---|---|---|---|---|---|
| 1 | Cascada + routing de 3 modelos | ✅ **100 %** | nada | — | — |
| 2 | Agent smoke testing | ✅ **100 %** | nada | — | — |
| 3 | Abstención | ⚠️ 61 % | no llega a 100 % nunca — es un juicio semántico | nuestro | continuo |
| 4 | Citas correctas | ⚠️ | **la procedencia ya está al 100 %**; la fidelidad tiene margen | nuestro | continuo |
| 5 | Latencia | ✅ **100 %** | nada | — | — |
| 6 | Correo / comunicaciones | ✅ **100 %** | nada | — | — |
| 7 | Google Calendar bidireccional | ⚠️ 70 % | **2 credenciales en Vercel** + verificación de Google | mixto | 5 min + 10 días |
| 8 | Transcripción | ⚠️ 66 % | pasar de lotes a streaming | nuestro | 3–5 días |
| 9 | Invitaciones de equipo | ❓ | **enviar una invitación real** | tuyo | 2 min |
| 10 | Historial de conversaciones | ✅ **100 %** | nada | — | — |

**5 al 100 % · 4 con limitación · 1 sin verificar · 0 incumplidos.**

---

## 1 · Cascada + routing de 3 modelos — ✅ 100 %

**Falta: nada.**

Verificado contra los tres proveedores reales: Gemini responde en 4,0 s, Claude en 7,2 s; el camino
feliz se queda en DeepSeek (1,4 s) sin llamar a los otros; con el primario caído responde Gemini
(3,9 s); con los dos primeros caídos **llega hasta Claude** (3,7 s).

Routing en dos niveles: por **tarea** (redacción vs. liviano) y por **consulta** — con cobertura
`limited` la nota escala al modelo que mide mejor en fidelidad. Es el 12-15 % de los casos, medido
antes de encenderlo.

> ⚠️ **Para la reunión:** `app/retrieval/cascade.py` es la cascada de **recuperación de documentos** y
> **no** es evidencia de esta cláusula. La evidencia es `app/generation/provider_cascade.py`.

## 2 · Agent smoke testing — ✅ 100 %

**Falta: nada.**

22 casos corriendo en CI + `docs/AGENT-SMOKE-TESTING.md`. Encontró la corrupción silenciosa de fechas
(`2026-02-30` se agendaba el 2 de marzo). El gap de `payload_override` quedó cerrado con 9 pruebas.

**Y el ciclo completo se verificó hoy en producción:** Athos propuso una cita, apareció la tarjeta, el
veterinario aprobó, y quedó `status: executed` con `appointment_id: 474b353a-…`.

## 3 · Abstención — ⚠️ 61 % de acierto

**Falta para el 100 %: no existe el 100 % acá, y conviene decirlo así.**

Es un juicio semántico sobre si la literatura cubre un caso clínico. Hoy acierta **11 de 18** con sólo
**1 de 16** de sobre-abstención — y la sobre-abstención importa tanto como el acierto: abstenerse de
más también daña.

**Lo que sí se puede subir**, con medición y sin promesas: rehacer el banco de negativos con validación
clínica y recalibrar los cortes. Antecedente que lo justifica: **24 de 42 casos del banco original no
eran negativos** — tenían literatura real. Toda medición anterior a esa corrección medía otra cosa.

> **Para la reunión:** el "0 activaciones en 187 casos" que reportó el cliente **era correcto**. La
> causa: el umbral determinístico está saturado (score 1.701 vs 1.700; reranker 0,532 vs 0,499; nº de
> citas 6,0 vs 6,0). Ninguna señal gratuita discrimina cobertura. Por eso ahora hay un juez que **lee**
> los pasajes.

## 4 · Citas de fuentes correctas — ⚠️ una capa al 100 %, la otra con margen

| Capa | Estado | Falta |
|---|---|---|
| **Procedencia** (determinística) | ✅ **100 %** | nada — **0 citas inventadas** en todas las corridas |
| **Fidelidad** (LLM) | ⚠️ | ~1 de cada 6 descartes puede quitar una fuente válida |

**Falta para el 100 % de la segunda capa:** tampoco existe. Es un juicio sobre si un pasaje sostiene
una afirmación. Revisión humana de 6 descartes → 4 correctos, 1 defendible, 1 falso positivo.

Sin calibrar descartaba el **58 %**; calibrado, el 13-18 %, y ninguna respuesta queda sin fuentes.
Falla abierta: si el verificador no puede opinar, las citas quedan como estaban.

**El origen, medido:** 18 de 24 respuestas citaban al menos un pasaje que no respaldaba la afirmación.

## 5 · Latencia — ✅ 100 %

**Falta: nada.** **12,8 s al primer token**, 27,6 s completo, medido desde fuera del datacenter.

Los ~5 minutos no se reproducen. Causa probable del reporte original: el Tier 1 tardaba **15.397 ms y
se cancelaba por `statement_timeout`** — se percibe como cuelgue, no como lentitud. Corregido: **143 ms**.

## 6 · Correo / módulo de comunicaciones — ✅ 100 %

**Falta: nada.** Envío por SMTP, lectura de respuestas por IMAP, hilos, credenciales cifradas, pantalla
de conexión, facturas por correo y **recordatorios de cobranza por correo** — este último era el cable
suelto y se cerró hoy con 8 pruebas.

> Nota: cada clínica conecta su propia cuenta desde `/dashboard/settings`. Que el módulo esté al 100 %
> no significa que una clínica concreta ya lo haya conectado.

## 7 · Google Calendar bidireccional — ⚠️ 70 %

| Dirección | Estado |
|---|---|
| Plataforma → Google (crear / borrar a mano) | ✅ automático |
| **Citas creadas por el agente** | ✅ **cerrado hoy** |
| Google → Plataforma | ⚠️ manual, botón "Sincronizar" |

**Falta para el 100 %, y son dos cosas distintas:**

1. **`GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Vercel** — 5 minutos, es lo que desbloquea la
   sincronización. **Ninguna de las dos está configurada.**
2. **Verificación de Google** (~10 días, trámite de un tercero) para que la traída Google→plataforma
   sea automática en vez de un botón.

> **Precisión que corrige una afirmación previa mía:** *conectar* Google **sí funciona** sin esas
> credenciales — la ruta de conexión sólo guarda el `refresh_token` del login. Lo que falla es la
> **sincronización**: `pushAppointment` → `accessTokenFrom()` → `googleCreds()` lanza
> `"Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET"`.
>
> Hoy `calendar_integrations` tiene **0 filas**, así que `pushAppointment` devuelve `null` en su
> primera línea **sin lanzar** — por eso la cita del agente quedó con `google_event_id: null` y sin
> error. **Si alguien conectara Google hoy, la sincronización empezaría a fallar.** Las credenciales
> hay que ponerlas antes.

**Dónde está el botón:** `/dashboard/calendario`, barra superior junto a "Nueva cita". Si Google no
está conectado dice **"Conectar Google Calendar"**; "Sincronizar" sólo aparece una vez conectado.

## 8 · Transcripción — ⚠️ 66 % (dos de tres)

| Defecto reportado | Estado |
|---|---|
| **Roles invertidos** | ✅ **corregido** |
| **Fecha errada** | ✅ **corregido** |
| **Por lotes, no en vivo** | ⚠️ **pendiente** |

**Falta para el 100 %:** pasar del endpoint por lotes al de streaming — WebSocket contra Deepgram y una
interfaz que muestre el texto incremental. **3 a 5 días**, es lo único.

Confirmado hoy que sigue por lotes: `app/transcription.py:90` hace `POST` a `api.deepgram.com/v1/listen`
con el audio completo.

**Roles:** la causa era que `SPEAKER_LABELS` asumía hablante 0 = veterinario, y Deepgram numera **por
orden de habla**, con la etiqueta **horneada** en `full_text`. Ahora el rol se infiere del **contenido**
(`app/speaker_roles.py`), determinístico y auditable.

**Fecha:** 3 pantallas formateaban en UTC porque los componentes de servidor corren en UTC en Vercel.
Ancladas a `America/Bogotá`, con pruebas que fuerzan `TZ=UTC` para que no vuelva.

## 9 · Invitaciones de equipo — ❓ el código está, falta la prueba

**Cuatro bugs corregidos, de dos personas:**

| Bug | Quién |
|---|---|
| `redirectTo` iba a `/invitar/<token>`, que no establece sesión → el enlace "no hacía nada" | nosotros |
| El origen salía del dominio efímero del deployment | nosotros |
| `/auth/signout` era `GET`: el prefetch de un `<Link>` **cerraba la sesión solo** | nosotros |
| `?next=` podía quedar vacío y la plantilla de Supabase concatena `&token_hash=` sobre él | Santiago |

**Falta para el 100 %: enviar una invitación real y hacer clic en el enlace. Dos minutos.**

> **Por qué no lo doy por cerrado sin eso:** los cuatro bugs están verificados por lectura, pero el
> fallo original era de **integración entre el código y la plantilla de correo de Supabase**, y eso no
> se comprueba leyendo. Nadie ha enviado una invitación desde que se corrigieron.

## 10 · Historial de conversaciones — ✅ 100 %

**Falta: nada.** `src/lib/athos-history.ts`, consumido por `/dashboard/asistente`.

Los datos **existían desde el inicio** en `athos_messages` — nunca se perdieron. Faltaba la pantalla.

---

## Resumen de lo que falta, por dueño

### Tuyo — 7 minutos en total

| Qué | Cierra | Tiempo |
|---|---|---|
| **Enviar una invitación real** y hacer clic | punto 9 → ✅ | 2 min |
| **`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` en Vercel** | punto 7 → 90 % | 5 min |

Con esas dos cosas: **7 de 10 al 100 %**.

### Nuestro

| Qué | Cierra | Esfuerzo |
|---|---|---|
| Transcripción en tiempo real | punto 8 → ✅ | 3–5 días |
| Subir abstención (61 %) y recall del auditor (0,47) | puntos 3 y 4 | medición continua |

### De terceros — no depende de esfuerzo nuestro

| Insumo | Quién | Tiempo | Cierra |
|---|---|---|---|
| Verificación de Google | Google | ~10 días | punto 7 → ✅ |

---

## Otras variables ausentes en Vercel

El código lee **34** variables de entorno; en Vercel hay **8**. Además de las dos de Google, faltan las
de WhatsApp:

| Variable | Qué rompe |
|---|---|
| `WHATSAPP_TOKEN_KEY` | cifrado de los tokens de Meta — **lanza al conectar** |
| `META_APP_ID`, `META_APP_SECRET`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID` | WhatsApp embebido de Meta (cae al proveedor que sale de la plataforma) |
| `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN`, `NEXT_PUBLIC_SITE_URL` | el proveedor alternativo de WhatsApp |

**Las demás ausencias no importan** — tienen valor por defecto correcto: `ATHOS_AGENT_PROVIDER` y
`ATHOS_AGENT_MODEL` (por eso el agente funciona con Claude sin estar configuradas), `ATHOS_AUTO_*`,
`ATHOS_VISION_MODEL`, `DEEPSEEK_*`, `NEXT_PUBLIC_APP_URL` (cae a la URL de producción que Vercel provee
sola), `TZ` y `CARTERA_MESSAGING_SIMULATED`.

## Lo que quedó confirmado hoy en producción

| | Evidencia |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` en Vercel | ✅ visto en la captura — **último P0 cerrado** |
| `ANTHROPIC_API_KEY` en Vercel | ✅ el agente respondió |
| `NEXT_PUBLIC_ATHOS_URL` | ✅ `POST /athos/retrieve → 200 OK` en Railway |
| `CRON_SECRET` | ✅ `/api/health` responde 401, no 503 |
| Ciclo agéntico completo | ✅ propuso → aprobó → ejecutó → `appointment_id` real |

**488 pruebas** (212 backend + 276 front), todas ejecutadas localmente. `ruff` y `tsc` limpios.
